/* zapo-rest — a single compiled executable that runs a real WhatsApp client
 * against a persistent MySQL store and exposes zapo's public surface as a
 * plain-JSON HTTP API.
 *
 * Route convention, so a caller who knows zapo can guess the route:
 *     <coordinator>.<method>   ->   /<coordinator>/<method>
 * Reads take query parameters, writes take a JSON body; both are merged, so
 * every route also answers to query parameters ("?jid=...&limit=10").
 *
 * Every handler runs inside a guard. A method the compiler could not lower
 * statically becomes a runtime throw carrying an [SCxxxx] code; the guard
 * turns that into HTTP 501 naming the code, so an unimplemented method is
 * reported rather than silently missing, and one such method cannot take the
 * process down.
 */
import { createServer } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Socket } from "node:net";
/* The WebSocket push endpoint's Sec-WebSocket-Accept (RFC 6455 §4.2.2).
 * sha1 exists in the lowered digest set for exactly this. */
import { createHash } from "node:crypto";
/* zapo-js MUST be imported before @zapo-js/store-mysql: the two provenance
 * checkouts collide on ~39 tsconfig "paths" alias keys, the paths table is one
 * per program, and the FIRST package seen wins. With store-mysql first, zapo-js's
 * own @client/@store aliases are lost and its barrel fails to resolve. */
import { WaClient, createStore } from "zapo-js";
import type { WaIncomingMessageEvent, WaStoreSession } from "zapo-js";
/* `mysql2` is NOT imported here, by type or by value -- see "the raw-SQL
 * surface" below for why, and for the one cast that is the whole seam. */
import { createMysqlStore, createMysqlPool } from "@zapo-js/store-mysql";

/* ── configuration ─────────────────────────────────────────────────────── */

function envStr(name: string, fallback: string): string {
  const v = process.env[name];
  return v !== undefined && v !== "" ? v : fallback;
}
function envNum(name: string, fallback: number): number {
  const v = process.env[name];
  if (v === undefined || v === "") return fallback;
  const n = Number(v);
  return n === n ? n : fallback;
}

const HOST = envStr("ZAPO_REST_HOST", "127.0.0.1");
const PORT = envNum("ZAPO_REST_PORT", 8787);
const TOKEN = envStr("ZAPO_REST_TOKEN", "");
/* WHERE THE STATE LIVES. The SQLite build took one path; a server takes five
 * values. The names are the ones the measurement rig already passes
 * (mysqlmem/run-arm.sh builds ZAPO_MYSQL_HOST/PORT/USER/PASSWORD/DATABASE),
 * so the arm needs no new dial. */
const MYSQL_HOST = envStr("ZAPO_MYSQL_HOST", "127.0.0.1");
const MYSQL_PORT = envNum("ZAPO_MYSQL_PORT", 3306);
const MYSQL_USER = envStr("ZAPO_MYSQL_USER", "root");
/* An EMPTY password is a real configuration, so this one cannot use envStr:
 * envStr treats "" as absent and would substitute the fallback. */
const MYSQL_PASSWORD = process.env["ZAPO_MYSQL_PASSWORD"] !== undefined ? process.env["ZAPO_MYSQL_PASSWORD"] : "";
const MYSQL_DATABASE = envStr("ZAPO_MYSQL_DATABASE", "zapo");
/* THE ONE PER-PROCESS CACHE-SHAPED DIAL -- see the store block for why it is
 * not a translation of ZAPO_SQLITE_CACHE_KB. mysql2's own default is 10. */
const POOL_SIZE = envNum("ZAPO_MYSQL_POOL_SIZE", 10);
/* The MySQL store needs an explicit cleanup poller or its five cache domains
 * grow monotonically; SQLite evicts those lazily on read and needs none. This
 * is therefore a MySQL-ONLY background timer with no SQLite counterpart, and
 * it is a dial so an arm can take it out of the comparison. */
const CLEANUP_ON = envStr("ZAPO_MYSQL_CLEANUP", "1") !== "0";
/* For display only, and never parsed back: the password is not in it. */
const DB_DSN = `mysql://${MYSQL_USER}@${MYSQL_HOST}:${MYSQL_PORT}/${MYSQL_DATABASE}`;
/* ZAPO_DB names a SQLite FILE and this program has none. The rig passes it to
 * both arms from one template, so it is read and reported as ignored rather
 * than silently dropped -- a stale state.sqlite next to a MySQL run must not
 * be mistaken for this program's state. */
const IGNORED_DB_PATH = envStr("ZAPO_DB", "");
/* The session an UNPREFIXED route is addressed to. Every route also
 * answers at /s/<sessionId>/<route> for any session in the registry. */
const DEFAULT_SESSION = envStr("ZAPO_SESSION", "default");
const EVENT_BUFFER = envNum("ZAPO_EVENT_BUFFER", 1000);
const AUTOCONNECT = envStr("ZAPO_AUTOCONNECT", "1") !== "0";
/* A clean exit route, off by default.
 *
 * Every allocation-census instrument under tests/perf writes its report
 * from atexit, or from the _Exit interposer those headers install. This
 * service had no route out of the process: the memory rigs SIGKILL the
 * child, so a census of the SETTLED heap - the state that matters for the
 * retention question, minutes after a history sync - could never be
 * dumped at all. One HTTP route fixes that for every such instrument at
 * once, and it costs a shipped service nothing because the route does not
 * exist unless ZAPO_REST_ALLOW_SHUTDOWN=1. */
const ALLOW_SHUTDOWN = envStr("ZAPO_REST_ALLOW_SHUTDOWN", "0") !== "0";
/* The exit is deferred by one timer turn so the response is written and
 * the socket flushed before the process goes; a caller that read
 * {"stopping":true} knows the exit was accepted. */
const SHUTDOWN_DELAY_MS = envNum("ZAPO_REST_SHUTDOWN_MS", 250);

/* ── the WebSocket push endpoint's dials ───────────────────────────────── */

/* How many events the server will send a subscriber ahead of its last
 * acknowledgement. This is the WHOLE slow-consumer policy and it is
 * deliberately a WINDOW rather than a queue: the service holds no
 * per-subscriber buffer at all, so a consumer that stops reading cannot
 * grow this process's memory. It only stops being sent to. What it missed
 * stays where it already was -- in the per-session ring, which is bounded
 * (EVENT_BUFFER entries) and which the polling /events route reads from
 * too, so a subscriber and a poller cost the same memory.
 *
 * Node exposes socket.writableLength and a 'drain' event and this design
 * would rather use them; the compiled surface has neither (net Socket
 * lowers write/end/destroy/pipe/setTimeout/remoteAddress/read/unshift and
 * data/end/close/error/connect/timeout/readable). An ack window needs
 * only arithmetic, so it is what the compiled lane can actually enforce. */
const WS_WINDOW = envNum("ZAPO_WS_WINDOW", 64);
/* How long a subscriber may sit at the window before the server gives up on
 * it and closes with 1013 (try again later). The consumer reconnects with
 * ?since=<its last seq> and refills from the ring. */
const WS_LAG_MS = envNum("ZAPO_WS_LAG_MS", 30000);
/* The route suffix, under the same /s/<sessionId>/ addressing as every
 * other route: /s/<id>/events/ws, or /events/ws for ZAPO_SESSION. */
const WS_ROUTE = "/events/ws";

const STARTED_MS = Date.now();

/* ── tiny JSON/param plumbing ──────────────────────────────────────────── */

type Bag = Record<string, unknown>;

function percentDecode(s: string): string {
  let out = "";
  let i = 0;
  while (i < s.length) {
    const ch = s.charAt(i);
    if (ch === "+") {
      out += " ";
      i += 1;
    } else if (ch === "%" && i + 2 < s.length + 1) {
      const hex = s.slice(i + 1, i + 3);
      const code = parseInt(hex, 16);
      if (code === code) {
        out += String.fromCharCode(code);
        i += 3;
      } else {
        out += ch;
        i += 1;
      }
    } else {
      out += ch;
      i += 1;
    }
  }
  return out;
}

function parseQuery(query: string, into: Bag): void {
  if (query === "") return;
  const parts = query.split("&");
  for (const part of parts) {
    if (part === "") continue;
    const eq = part.indexOf("=");
    if (eq === -1) {
      into[percentDecode(part)] = "";
    } else {
      into[percentDecode(part.slice(0, eq))] = percentDecode(part.slice(eq + 1));
    }
  }
}

function str(p: Bag, key: string): string | undefined {
  const v = p[key];
  if (typeof v === "string") return v;
  if (typeof v === "number") return String(v);
  if (typeof v === "boolean") return v ? "true" : "false";
  return undefined;
}
function reqStr(p: Bag, key: string): string {
  const v = str(p, key);
  if (v === undefined) throw new Error(`missing required parameter '${key}'`);
  return v;
}
function num(p: Bag, key: string): number | undefined {
  const v = p[key];
  if (typeof v === "number") return v;
  if (typeof v === "string" && v !== "") {
    const n = Number(v);
    if (n === n) return n;
  }
  return undefined;
}
function reqNum(p: Bag, key: string): number {
  const v = num(p, key);
  if (v === undefined) throw new Error(`missing required numeric parameter '${key}'`);
  return v;
}
function bool(p: Bag, key: string): boolean | undefined {
  const v = p[key];
  if (typeof v === "boolean") return v;
  if (typeof v === "string") {
    if (v === "true" || v === "1" || v === "yes") return true;
    if (v === "false" || v === "0" || v === "no") return false;
  }
  return undefined;
}
function reqBool(p: Bag, key: string): boolean {
  const v = bool(p, key);
  if (v === undefined) throw new Error(`missing required boolean parameter '${key}'`);
  return v;
}
function list(p: Bag, key: string): string[] {
  const v = p[key];
  if (typeof v === "string") {
    if (v === "") return [];
    return v.split(",");
  }
  if (Array.isArray(v)) {
    const out: string[] = [];
    for (const item of v) {
      if (typeof item === "string") out.push(item);
      else if (typeof item === "number") out.push(String(item));
    }
    return out;
  }
  return [];
}
function reqList(p: Bag, key: string): string[] {
  const v = list(p, key);
  if (v.length === 0) throw new Error(`missing required list parameter '${key}' (comma-separated, or a JSON array)`);
  return v;
}
/** A nested object parameter, for the routes whose zapo argument is a record. */
function obj(p: Bag, key: string): Bag | undefined {
  const v = p[key];
  if (typeof v === "object" && v !== null && !Array.isArray(v)) return v as Bag;
  return undefined;
}

/** The message reference a reaction/revoke/pin content carries, read out of
 * a nested `target` object. One declared shape, so the literal the routes
 * hand zapo is the same one whether it came from query parameters or from a
 * JSON `content` body. */
function quoteRefOf(c: Bag): { remoteJid: string; id: string; fromMe: boolean; participant: string | undefined } {
  const t = obj(c, "target");
  if (t === undefined) {
    throw new Error("missing required parameter 'target' (an object with 'remoteJid' and 'id')");
  }
  return {
    remoteJid: reqStr(t, "remoteJid"),
    id: reqStr(t, "id"),
    fromMe: bool(t, "fromMe") === true,
    participant: str(t, "participant"),
  };
}

/** The record argument for a route whose zapo method takes one options/input
 * object: either an explicit "input" member, or the whole request bag. */
function inputOf(p: Bag): Bag {
  const nested = obj(p, "input");
  return nested !== undefined ? nested : p;
}

function safeJson(value: unknown): string {
  try {
    const s = JSON.stringify(value);
    return s !== undefined ? s : "null";
  } catch (err: unknown) {
    return JSON.stringify({ unserializable: String(err) });
  }
}

/* ── the event ring, per session ───────────────────────────────────────── */

interface Ev {
  readonly seq: number;
  readonly at: number;
  readonly type: string;
  readonly data: unknown;
}

/* ── the store: ONE pool, N sessions ──────────────────────────────────── */

/* WHY THERE IS NO ZAPO_SQLITE_CACHE_KB HERE, AND NOTHING STANDING IN FOR IT.
 *
 * In the SQLite build the page cache is a PROCESS-side allocation and
 * `cache_size` caps it, so the knob belonged to this program: it branched the
 * store construction and both connection openers, three sites in all. In
 * MySQL the page cache is `innodb_buffer_pool_size`, which lives in the
 * SERVER and is shared by every client of that server. This process cannot
 * set it; a process that did set it would be resizing the cache for every
 * other connection to the same instance, which is not what the SQLite knob
 * did. There is therefore no per-process cache knob to branch on, and the
 * branch is DELETED rather than faked with a dial that controls nothing.
 *
 * The server's figure is still worth having, so it is read once at startup
 * and reported on /health under a `server` key, labelled as a server
 * property. ONCE, because /health is in the measured path -- the rig polls
 * it -- and a round trip added there would change the workload being
 * compared rather than measure it.
 *
 * The one dial that IS this process's, and that really does bound what this
 * program holds on the database's behalf because every pooled connection
 * carries its own packet buffers, is the pool size. That is POOL_SIZE. It is
 * NOT a translation of the cache knob and must not be reported as one. */

/* ── the raw-SQL surface, declared here and not imported ──────────────── */

/* THE MODULE-LEVEL CONNECTION TYPE.
 *
 * The SQLite build held a `WaSqliteConnection` -- ONE handle on ONE file --
 * at module level and threaded it through tableExists, ensureRegistryTable
 * and knownIds. The MySQL counterpart of that handle is a POOL, not a
 * connection, and that is a difference in kind rather than in spelling: a
 * pool is N physical connections and a statement does not choose which one
 * it lands on.
 *
 * It makes the SQLite build's hardest claim free. There, "one connection
 * serves every session" had to be PROVEN, because `openSqliteConnection`
 * keys a process-wide cache on driver|path|pragmas|tableNames and a service
 * that opened its raw handle with different pragmas got a second connection
 * to the same file -- which is exactly what that build's predecessor did.
 * Here the pool is constructed once, below, and handed to
 * `createMysqlStore`, which passes that same object into every per-domain
 * store (BaseMysqlStore's constructor assigns `this.pool = options.pool`).
 * The service's raw SQL and the stores' SQL go through the identical object,
 * by construction, with no cache to miss.
 *
 * The TYPE is declared structurally here rather than imported from
 * `mysql2/promise`. The operative reason is not brevity: `mysql2` is not
 * type-resolvable on the compiler's provenance lane, so an
 * `import type { Pool }` in this file would plant a NEW island root HERE.
 * Declaring the four methods this program uses keeps every blocker this file
 * contributes at zero and leaves the mysql2 cascade entirely inside
 * @zapo-js/store-mysql, which is where it is and where it is being fixed.
 * The single `as unknown as` below is the whole seam.
 *
 * `execute` and not `query`: prepared statements are what every statement in
 * every one of the 16 domain stores uses, so the service's raw reads ride
 * the same client-side prepare cache and the same server-side
 * `max_prepared_stmt_count` budget the product does. A raw read on the text
 * protocol would be measuring a path the product does not have. */
type SqlOut = [unknown, unknown];
interface MysqlExec {
  execute(sql: string, values?: readonly unknown[]): Promise<SqlOut>;
}
interface MysqlTxConn extends MysqlExec {
  beginTransaction(): Promise<void>;
  commit(): Promise<void>;
  rollback(): Promise<void>;
  release(): void;
}
interface MysqlPool extends MysqlExec {
  getConnection(): Promise<MysqlTxConn>;
  end(): Promise<void>;
}
/** A background timer this program must be able to stop. Structural for the
 * same reason as the pool: the concrete class reaches mysql2 through its own
 * store fields. */
interface Stoppable {
  stop(): void;
}

function rowsOf(out: SqlOut): Bag[] {
  const first = out[0];
  if (!Array.isArray(first)) return [];
  const list: Bag[] = [];
  for (const r of first) {
    if (typeof r === "object" && r !== null) list.push(r as Bag);
  }
  return list;
}
async function sqlAll(c: MysqlExec, sql: string, params: readonly unknown[]): Promise<Bag[]> {
  return rowsOf(await c.execute(sql, params));
}
async function sqlGet(c: MysqlExec, sql: string, params: readonly unknown[]): Promise<Bag | null> {
  const list = rowsOf(await c.execute(sql, params));
  return list.length === 0 ? null : list[0];
}
async function sqlRun(c: MysqlExec, sql: string, params: readonly unknown[]): Promise<void> {
  await c.execute(sql, params);
}
/** COUNT(*) is BIGINT. mysql2 hands it back as a number here, but a driver
 * configured for big numbers hands back a string or a bigint, and a silent
 * NaN would read as an empty table, so all three are accepted. */
function countOf(row: Bag | null, key: string): number {
  if (row === null) return 0;
  const v = row[key];
  if (typeof v === "number") return v;
  if (typeof v === "bigint") return Number(v);
  if (typeof v === "string") {
    const n = Number(v);
    return n === n ? n : 0;
  }
  return 0;
}

/** MySQL quotes identifiers with backticks, and a backtick inside one is
 * doubled -- so an interpolated name is an injection site. The SQLite build
 * wrapped table names in double quotes and relied on them coming from its
 * own constant list; this checks the code points instead, which holds even
 * when a name arrives from the server (it does: /store/counts enumerates
 * information_schema). An unsafe name raises rather than being escaped. */
function ident(name: string): string {
  if (name.length === 0 || name.length > 64) {
    throw new Error(`refusing to interpolate the identifier '${name}': bad length`);
  }
  for (let i = 0; i < name.length; i += 1) {
    const c = name.charCodeAt(i);
    const ok =
      (c >= 48 && c <= 57) || (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || c === 95 || c === 36;
    if (!ok) throw new Error(`refusing to interpolate the identifier '${name}': bad character`);
  }
  return "`" + name + "`";
}

/** A LIMIT MySQL will take in a prepared statement. The domain stores
 * interpolate their resolved limit for the same reason (thread.store.ts and
 * message.store.ts both emit a literal LIMIT), so this follows the store
 * rather than inventing a second convention. */
function limitOf(n: number, fallback: number): number {
  if (n !== n) return fallback;
  const i = Math.floor(n);
  if (i < 0) return 0;
  if (i > 1000000) return 1000000;
  return i;
}

/* ONE POOL, built here and OWNED here.
 *
 * `createMysqlStore` accepts either a live pool or the options to build one,
 * and ends the pool in destroy() only when it built it (it sets
 * ownsPool = !isPool(config.pool)). Building it here and passing the object
 * means this program owns the lifecycle, and -- the point -- it makes "the
 * stores and the service share one pool" visible at the call site instead of
 * something to be read back out of the result. */
const rawPool = createMysqlPool({
  host: MYSQL_HOST,
  port: MYSQL_PORT,
  user: MYSQL_USER,
  password: MYSQL_PASSWORD,
  database: MYSQL_DATABASE,
  connectionLimit: POOL_SIZE,
  waitForConnections: true,
});
/* THE SEAM. One cast, in one place; nothing in this file names a mysql2 type
 * on either side of it. */
const pool: MysqlPool = rawPool as unknown as MysqlPool;

const backend = createMysqlStore({ pool: rawPool });
const rootStore = createStore({
  backends: { mysql: backend },
  providers: {
    auth: "mysql",
    signal: "mysql",
    preKey: "mysql",
    session: "mysql",
    identity: "mysql",
    senderKey: "mysql",
    appState: "mysql",
    privacyToken: "mysql",
    messages: "mysql",
    threads: "mysql",
    contacts: "mysql",
  },
});

/* The MySQL cache domains need a poller per session or they grow without
 * bound; the SQLite ones evict lazily on read and need none. Held outside
 * the Session record, in two parallel arrays, for the same reason the
 * message events are: the value type stays a plain array element. */
const cleanupIds: string[] = [];
const cleanupPollers: Stoppable[] = [];

function startCleanupFor(id: string): void {
  if (!CLEANUP_ON) return;
  for (const seen of cleanupIds) {
    if (seen === id) return;
  }
  cleanupIds.push(id);
  cleanupPollers.push(backend.startCleanup(id));
}

function stopCleanupFor(id: string): void {
  const ids: string[] = [];
  const keep: Stoppable[] = [];
  for (let i = 0; i < cleanupIds.length; i += 1) {
    const at = cleanupIds[i];
    const poller = cleanupPollers[i];
    if (at === id) {
      poller.stop();
      continue;
    }
    ids.push(at);
    keep.push(poller);
  }
  cleanupIds.length = 0;
  cleanupPollers.length = 0;
  for (const v of ids) cleanupIds.push(v);
  for (const v of keep) cleanupPollers.push(v);
}

/* A SECOND, SEPARATELY POOLED SET OF CONNECTIONS, held open for the
 * multi-handle arm of the idle-release measurement. The SQLite build got its
 * second handle by varying one pragma so the connection cache would miss;
 * here a second pool is simply a second pool, so the arm needs no trick and
 * the negative control that build needed does not arise. Opened only when
 * /sessions/second is called, and never closed, which is the point: it must
 * sit idle while the primary pool is hammered. */
let secondPool: MysqlPool | null = null;

/* Assigned once the first round trip has succeeded. The pool object exists
 * from module scope -- createMysqlPool does not connect -- so this is NOT
 * the handle becoming available, it is the SERVER becoming reachable, which
 * is what the SQLite build's `conn` was actually gating on too. */
let conn: MysqlPool | null = null;
let storeReady = false;
let storeError: string | null = null;
/* Read once at startup and reported on /health. See the note above on why
 * this is not read per request. */
let serverFacts: Bag = {};

function db(): MysqlPool {
  if (conn === null) {
    throw new Error("the mysql pool has not reached the server yet; poll GET /sessions until ready is true");
  }
  return conn;
}

/* The 22 domain tables store-mysql creates, every one of which carries
 * session_id (and has it in its PRIMARY KEY). `_migrations` -- the 23rd --
 * is the only table in the schema that does not, because it is per-DATABASE.
 *
 * TWENTY-TWO, not the SQLite build's twenty-one: store-mysql's migration
 * 0020 adds `chat_metadata_cache`, which the SQLite program's list does not
 * carry. Listed here rather than discovered through information_schema, for
 * the same reason that build listed its own: a count that depends on
 * introspection is a count that changes when introspection does. */
const SESSION_TABLES: string[] = [
  "appstate_collection_index_values",
  "appstate_collection_versions",
  "appstate_sync_keys",
  "auth_credentials",
  "chat_metadata_cache",
  "device_list_cache",
  "group_participants_cache",
  "mailbox_contacts",
  "mailbox_messages",
  "mailbox_threads",
  "message_secrets_cache",
  "privacy_tokens",
  "retry_inbound_counters",
  "retry_outbound_messages",
  "sender_key_distribution",
  "sender_keys",
  "signal_identity",
  "signal_meta",
  "signal_prekey",
  "signal_registration",
  "signal_session",
  "signal_signed_prekey",
];

function isSessionTable(name: string): boolean {
  for (const t of SESSION_TABLES) {
    if (t === name) return true;
  }
  return false;
}

/** Every table in THIS database, read in one statement.
 *
 * The SQLite build asked `tableExists` once per table inside each loop,
 * which on a synchronous in-process handle is free. Here each of those is a
 * network round trip, so a loop over 22 tables that checked existence first
 * would be 44 round trips where 23 will do. The set is fetched once per
 * route call and NOT cached across calls, so a table created by a lazy
 * migration between two calls still appears -- which is the behaviour the
 * SQLite build had. */
async function listTables(c: MysqlExec): Promise<string[]> {
  const rows = await sqlAll(
    c,
    "SELECT table_name AS name FROM information_schema.tables WHERE table_schema = DATABASE() ORDER BY table_name",
    [],
  );
  const out: string[] = [];
  for (const r of rows) {
    const n = r["name"];
    if (typeof n === "string") out.push(n);
  }
  return out;
}

function hasTable(have: readonly string[], name: string): boolean {
  for (const t of have) {
    if (t === name) return true;
  }
  return false;
}

async function tableExists(c: MysqlExec, name: string): Promise<boolean> {
  const row = await sqlGet(
    c,
    "SELECT COUNT(*) AS n FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = ?",
    [name],
  );
  return countOf(row, "n") > 0;
}

/* ── the session registry ──────────────────────────────────────────────── */

/* IDENTIFIER. A session is named by the SAME string zapo's store writes into
 * the `session_id` column of all 21 domain tables. The REST identity and the
 * storage identity are therefore one value: there is no mapping table to
 * drift, and the owner of any row is legible from the database with a plain
 * SELECT. Accepted spelling: 1-64 characters from A-Za-z0-9 . _ -  (checked
 * by code point, not by a regex, so the check is the same in every backend).
 * zapo trims the id and rejects an empty one itself (createStore.ts:245);
 * this check is the stricter outer gate so a malformed id is a 400 from the
 * service rather than a throw from the store. */
const ID_SPELLING = "1-64 characters from A-Za-z0-9 and . _ -";

function idOk(id: string): boolean {
  if (id.length === 0 || id.length > 64) return false;
  for (let i = 0; i < id.length; i += 1) {
    const c = id.charCodeAt(i);
    const isDigit = c >= 48 && c <= 57;
    const isUpper = c >= 65 && c <= 90;
    const isLower = c >= 97 && c <= 122;
    const isPunct = c === 46 || c === 95 || c === 45;
    if (!isDigit && !isUpper && !isLower && !isPunct) return false;
  }
  return true;
}

interface Session {
  readonly id: string;
  readonly client: WaClient;
  readonly store: WaStoreSession;
  readonly createdMs: number;
  readonly events: Ev[];
  /* The incoming messages, kept a SECOND time at their real type.
   *
   * The ring above stores every event's payload as `unknown`, which is right
   * for /events and /messages (they serialize it) and useless for
   * `message.download*`, whose parameter is
   * `WaIncomingMessageEvent | Proto.IMessage` — a union, and an open JSON
   * record has no re-tag into one. The media a download needs (mediaKey,
   * directPath, fileEncSha256) only ever came from a real incoming event
   * anyway, so the download routes take the event's `seq` and read it back
   * here at the type zapo handed it over with. Two parallel arrays rather
   * than a Map so the value type stays a plain array element. */
  readonly msgSeqs: number[];
  readonly msgEvents: WaIncomingMessageEvent[];
  seq: number;
  qr: string | null;
  qrTtlMs: number;
  qrAt: number;
  pairingCode: string | null;
  lastEventSaidOpen: boolean;
  lastConnectionEvent: unknown;
  connectStarted: boolean;
  sent: number;
  recv: number;
  ready: boolean;
  error: string | null;
  hasCredentials: boolean;
  stopped: boolean;
}

let sessions: Session[] = [];

function findSession(id: string): Session | undefined {
  for (const s of sessions) {
    if (s.id === id) return s;
  }
  return undefined;
}

function push(sess: Session, type: string, data: unknown): void {
  sess.seq += 1;
  const ev: Ev = { seq: sess.seq, at: Date.now(), type: type, data: data };
  sess.events.push(ev);
  if (sess.events.length > EVENT_BUFFER) sess.events.shift();
  /* The same event, pushed to whoever is listening on a socket instead of
   * polling. The ring above is unchanged and is still the only buffer. */
  wsFanout(sess.id, ev);
}

function rememberMessage(sess: Session, seq: number, ev: WaIncomingMessageEvent): void {
  sess.msgSeqs.push(seq);
  sess.msgEvents.push(ev);
  if (sess.msgSeqs.length > EVENT_BUFFER) {
    sess.msgSeqs.shift();
    sess.msgEvents.shift();
  }
}

function messageBySeq(sess: Session, seq: number): WaIncomingMessageEvent | undefined {
  for (let i = 0; i < sess.msgSeqs.length; i++) {
    if (sess.msgSeqs[i] === seq) return sess.msgEvents[i];
  }
  return undefined;
}

function since(sess: Session, kindPrefix: string, from: number, limit: number): Ev[] {
  const out: Ev[] = [];
  for (const e of sess.events) {
    if (e.seq <= from) continue;
    if (kindPrefix !== "" && e.type !== kindPrefix) continue;
    out.push(e);
    if (out.length >= limit) break;
  }
  return out;
}

/* ── the WebSocket push endpoint ───────────────────────────────────────── */

/* GET /s/<sessionId>/events/ws  (and /events/ws for ZAPO_SESSION)
 *
 * The same events GET /events serves by polling, pushed as they happen.
 * The runtime ships a WebSocket CLIENT and no server, so the server half is
 * here in TypeScript: the 'upgrade' seam hands the socket over raw, and the
 * RFC 6455 framing below is the whole of what is needed. Proven byte-exact
 * against Node on both backends by tests/corpus/7760 and /7761, and against
 * Node's OWN built-in WebSocket client by
 * tests/fixtures/server/cases/ws-server.
 *
 * The wire: one JSON text frame per event, exactly the object /events
 * returns ({seq, at, type, data}), plus service frames whose `type` starts
 * with "$" so they can never collide with a zapo event name:
 *   {"type":"$hello","sessionId":..,"seq":..,"window":..,"buffered":..}
 *   {"type":"$gap","fromSeq":..,"toSeq":..}   events the ring dropped
 *   {"type":"$lag","sinceSeq":..}             the window closed on you
 * The client acknowledges with {"ack":<seq>} (a bare number is accepted
 * too). Acking is not optional past WS_WINDOW events -- see the dial's
 * note: the ack IS the backpressure signal, because the compiled socket
 * surface has no 'drain'. */

const WS_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

interface WsSub {
  readonly id: number;
  readonly sessionId: string;
  readonly sock: Socket;
  readonly typeFilter: string;
  /** The highest seq written to this socket. */
  lastSentSeq: number;
  /** The highest seq the client has acknowledged. */
  ackedSeq: number;
  /** At the window: nothing is being written, and the clock is running. */
  lagging: boolean;
  laggingSinceMs: number;
  dead: boolean;
}

let wsSubs: WsSub[] = [];
let wsNextId = 1;
let wsSweeping = false;

/** One frame, server side: FIN as asked, NEVER masked (RFC 6455 §5.1), and
 * the shortest length form the payload allows (§5.2). */
function wsFrame(opcode: number, payload: Buffer, fin: boolean): Buffer {
  const len = payload.length;
  let header: Buffer;
  if (len < 126) {
    header = Buffer.alloc(2);
    header[1] = len;
  } else if (len < 65536) {
    header = Buffer.alloc(4);
    header[1] = 126;
    header.writeUInt16BE(len, 2);
  } else {
    header = Buffer.alloc(10);
    header[1] = 127;
    header.writeUInt32BE(0, 2);
    header.writeUInt32BE(len, 6);
  }
  header[0] = (fin ? 0x80 : 0x00) | opcode;
  return Buffer.concat([header, payload]);
}

function wsSendText(sub: WsSub, text: string): void {
  if (sub.dead) return;
  sub.sock.write(wsFrame(0x1, Buffer.from(text, "utf8"), true));
}

function wsClose(sub: WsSub, code: number, reason: string): void {
  if (sub.dead) return;
  const r = Buffer.from(reason, "utf8");
  const p = Buffer.alloc(2 + r.length);
  p.writeUInt16BE(code, 0);
  r.copy(p, 2);
  sub.sock.write(wsFrame(0x8, p, true));
  wsDrop(sub);
  sub.sock.end();
}

function wsDrop(sub: WsSub): void {
  if (sub.dead) return;
  sub.dead = true;
  const keep: WsSub[] = [];
  for (const x of wsSubs) {
    if (x.id !== sub.id) keep.push(x);
  }
  wsSubs = keep;
}

function wsMatches(sub: WsSub, ev: Ev): boolean {
  return sub.typeFilter === "" || ev.type === sub.typeFilter;
}

/** Write one event, or note that the window is shut. Returns false when the
 * subscriber is at the window (nothing was written). */
function wsOffer(sub: WsSub, ev: Ev): boolean {
  if (sub.dead) return false;
  if (sub.lastSentSeq - sub.ackedSeq >= WS_WINDOW) {
    if (!sub.lagging) {
      sub.lagging = true;
      sub.laggingSinceMs = Date.now();
      /* One notice, then silence: telling a stalled consumer it is stalled
       * once is information, telling it every event is the same unbounded
       * write this design exists to avoid. */
      sub.sock.write(
        wsFrame(0x1, Buffer.from(safeJson({ type: "$lag", sinceSeq: sub.lastSentSeq }), "utf8"), true),
      );
    }
    return false;
  }
  sub.lagging = false;
  sub.lastSentSeq = ev.seq;
  if (wsMatches(sub, ev)) wsSendText(sub, safeJson(ev));
  return true;
}

function wsFanout(sessionId: string, ev: Ev): void {
  if (wsSubs.length === 0) return;
  for (const sub of wsSubs) {
    if (sub.sessionId !== sessionId) continue;
    wsOffer(sub, ev);
  }
}

/** After an ack: send what the ring still holds past lastSentSeq, up to the
 * window. Events the ring has already evicted are reported as a gap rather
 * than silently skipped -- a consumer that cannot tell it lost events is
 * worse than one that reconnects. */
function wsCatchUp(sub: WsSub): void {
  const sess = findSession(sub.sessionId);
  if (sess === undefined) return;
  const ring = sess.events;
  if (ring.length === 0) return;
  const oldest = ring[0];
  if (oldest !== undefined && oldest.seq > sub.lastSentSeq + 1 && sub.lastSentSeq > 0) {
    wsSendText(sub, safeJson({ type: "$gap", fromSeq: sub.lastSentSeq + 1, toSeq: oldest.seq - 1 }));
    sub.lastSentSeq = oldest.seq - 1;
  }
  for (const ev of ring) {
    if (ev.seq <= sub.lastSentSeq) continue;
    if (!wsOffer(sub, ev)) return;
  }
}

/** The lag reaper. It runs only while somebody is subscribed -- a
 * self-rescheduling timeout rather than a standing interval, so an idle
 * service holds no timer it does not need. */
function wsSweepLater(): void {
  if (wsSweeping) return;
  wsSweeping = true;
  setTimeout(() => {
    wsSweeping = false;
    const now = Date.now();
    const doomed: WsSub[] = [];
    for (const sub of wsSubs) {
      if (sub.lagging && now - sub.laggingSinceMs > WS_LAG_MS) doomed.push(sub);
    }
    for (const sub of doomed) {
      console.log(`  ws       : closing subscriber ${sub.id} (${sub.sessionId}); no ack for ${WS_LAG_MS}ms past seq ${sub.ackedSeq}`);
      wsClose(sub, 1013, "lagging");
    }
    if (wsSubs.length > 0) wsSweepLater();
  }, 1000);
}

/** The ack a client sends back: {"ack":<seq>} or a bare number. */
function wsReadAck(text: string): number {
  const bare = Number(text);
  if (bare === bare && text.trim() !== "") return bare;
  try {
    const parsed = JSON.parse(text) as unknown;
    if (typeof parsed === "object" && parsed !== null) {
      const bag = parsed as Bag;
      const a = bag["ack"];
      if (typeof a === "number") return a;
    }
  } catch (err: unknown) {
    void err;
  }
  return -1;
}

function wsRefuse(sock: Socket, status: number, text: string): void {
  const body = safeJson({ error: text });
  sock.write(
    `HTTP/1.1 ${status} ${status === 401 ? "Unauthorized" : status === 404 ? "Not Found" : "Bad Request"}\r\n` +
      "content-type: application/json; charset=utf-8\r\n" +
      `content-length: ${Buffer.byteLength(body, "utf8")}\r\n` +
      "connection: close\r\n\r\n" +
      body,
  );
  sock.end();
}

function wsAttach(req: IncomingMessage, sock: Socket, head: Buffer): void {
  const raw = req.url !== undefined ? req.url : "/";
  const qIdx = raw.indexOf("?");
  const path = qIdx === -1 ? raw : raw.slice(0, qIdx);
  const query = qIdx === -1 ? "" : raw.slice(qIdx + 1);
  const p: Bag = {};
  parseQuery(query, p);

  /* The same key the HTTP routes want. A browser's WebSocket cannot set a
   * header, so ?token= is accepted for it and for nothing else. */
  if (TOKEN !== "") {
    const given = req.headers["x-api-key"];
    const q = p["token"];
    if (given !== TOKEN && !(typeof q === "string" && q === TOKEN)) {
      wsRefuse(sock, 401, "unauthorized: set the x-api-key header (or ?token=) to ZAPO_REST_TOKEN");
      return;
    }
  }

  let id = DEFAULT_SESSION;
  let sub = path;
  if (path.indexOf(SESSION_PREFIX) === 0) {
    const rest = path.slice(SESSION_PREFIX.length);
    const slash = rest.indexOf("/");
    id = slash === -1 ? rest : rest.slice(0, slash);
    sub = slash === -1 ? "/" : rest.slice(slash);
  }
  if (sub !== WS_ROUTE) {
    wsRefuse(sock, 404, `no websocket route at '${path}'; the only one is /s/<sessionId>${WS_ROUTE}`);
    return;
  }
  if (!idOk(id)) {
    wsRefuse(sock, 400, `invalid session id '${id}'; expected ${ID_SPELLING}`);
    return;
  }
  const sess = findSession(id);
  if (sess === undefined) {
    wsRefuse(sock, 404, `no such session '${id}'`);
    return;
  }

  const key = req.headers["sec-websocket-key"];
  if (typeof key !== "string" || key === "") {
    wsRefuse(sock, 400, "missing Sec-WebSocket-Key");
    return;
  }
  const accept = createHash("sha1").update(key + WS_GUID).digest("base64");
  sock.write(
    "HTTP/1.1 101 Switching Protocols\r\n" +
      "Upgrade: websocket\r\n" +
      "Connection: Upgrade\r\n" +
      `Sec-WebSocket-Accept: ${accept}\r\n\r\n`,
  );

  const typeFilter = str(p, "type") !== undefined ? reqStr(p, "type") : "";
  /* ?since=<seq> replays from the ring; absent means live-only, so a fresh
   * consumer is not handed a thousand events it never asked for. */
  const sinceSeq = num(p, "since") !== undefined ? reqNum(p, "since") : sess.seq;

  const entry: WsSub = {
    id: wsNextId,
    sessionId: sess.id,
    sock: sock,
    typeFilter: typeFilter,
    lastSentSeq: sinceSeq,
    ackedSeq: sinceSeq,
    lagging: false,
    laggingSinceMs: 0,
    dead: false,
  };
  wsNextId += 1;
  wsSubs.push(entry);
  console.log(`  ws       : subscriber ${entry.id} on ${sess.id} from seq ${sinceSeq}${typeFilter !== "" ? ` type=${typeFilter}` : ""}`);

  wsSendText(
    entry,
    safeJson({
      type: "$hello",
      sessionId: sess.id,
      seq: sess.seq,
      since: sinceSeq,
      window: WS_WINDOW,
      lagCloseMs: WS_LAG_MS,
      buffered: sess.events.length,
      note: "acknowledge with {\"ack\":<seq>}; the server sends at most `window` events past your last ack",
    }),
  );
  wsCatchUp(entry);
  wsSweepLater();

  /* The frame reader. `head` is whatever arrived past the request head --
   * a pipelining client can put its first frame there. */
  let buf: Buffer = head.length > 0 ? Buffer.from(head) : Buffer.alloc(0);
  let fragOp = -1;
  let frag: Buffer = Buffer.alloc(0);

  const pump = (chunk: Buffer): void => {
    buf = Buffer.concat([buf, chunk]);
    for (;;) {
      if (buf.length < 2) return;
      const b0 = buf[0] ?? 0;
      const b1 = buf[1] ?? 0;
      const fin = (b0 & 0x80) !== 0;
      const op = b0 & 0x0f;
      const masked = (b1 & 0x80) !== 0;
      let len = b1 & 0x7f;
      let off = 2;
      if (len === 126) {
        if (buf.length < 4) return;
        len = buf.readUInt16BE(2);
        off = 4;
      } else if (len === 127) {
        if (buf.length < 10) return;
        /* A frame this process could not hold anyway: refuse rather than
         * truncate the length into 32 bits. */
        if (buf.readUInt32BE(2) !== 0) { wsClose(entry, 1009, "frame too large"); return; }
        len = buf.readUInt32BE(6);
        off = 10;
      }
      let mask: Buffer = Buffer.alloc(4);
      if (masked) {
        if (buf.length < off + 4) return;
        mask = Buffer.from(buf.subarray(off, off + 4));
        off += 4;
      }
      if (buf.length < off + len) return;
      const payload = Buffer.from(buf.subarray(off, off + len));
      if (masked) {
        for (let i = 0; i < len; i++) payload[i] = (payload[i] ?? 0) ^ (mask[i & 3] ?? 0);
      }
      buf = Buffer.from(buf.subarray(off + len));

      /* RFC 6455 §5.1: a client frame MUST be masked. */
      if (!masked) { wsClose(entry, 1002, "unmasked client frame"); return; }

      if (op === 0x0 || op === 0x1 || op === 0x2) {
        if (op !== 0x0) { fragOp = op; frag = Buffer.alloc(0); }
        frag = Buffer.concat([frag, payload]);
        if (!fin) continue;
        const whole = frag;
        frag = Buffer.alloc(0);
        const wasOp = fragOp;
        fragOp = -1;
        if (wasOp !== 0x1) continue; /* binary from a consumer means nothing here */
        const ack = wsReadAck(whole.toString("utf8"));
        if (ack >= 0) {
          if (ack > entry.ackedSeq) entry.ackedSeq = ack;
          if (entry.lagging) { entry.lagging = false; wsCatchUp(entry); }
        }
      } else if (op === 0x9) {
        sock.write(wsFrame(0xa, payload, true));
      } else if (op === 0x8) {
        /* Echo the CODE only -- the reason is the peer's, not ours. */
        sock.write(wsFrame(0x8, Buffer.from(payload.subarray(0, len >= 2 ? 2 : 0)), true));
        wsDrop(entry);
        sock.end();
        return;
      }
    }
  };

  sock.on("error", () => { wsDrop(entry); sock.destroy(); });
  sock.on("close", () => { wsDrop(entry); });
  sock.on("end", () => { wsDrop(entry); });
  sock.on("data", (chunk: Buffer) => { pump(chunk); });
  if (buf.length > 0) pump(Buffer.alloc(0));
}

function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i += 1) {
    out[i] = Number.parseInt(hex.substring(i * 2, i * 2 + 2), 16);
  }
  return out;
}

/* ZAPO_WS_URL alone is NOT enough to reach a local fake server, and that gap
 * cost a block a day. The fake server signs its static key with an ephemeral
 * root CA, so a client pointed at it with the PRODUCTION root still refuses
 * the handshake -- the url override lands, the certificate check rejects, and
 * it reads as the fake server being broken. ZAPO_WS_CA_PUB (hex, 32 bytes)
 * and ZAPO_WS_CA_SERIAL inject that root through zapo's own testHooks, which
 * REPLACES the trusted root rather than skipping verification: the full
 * certificate-chain path still runs. Unset -- the shipped default and every
 * real-WhatsApp run -- leaves the production root in place. */
const WS_CA_PUB = envStr("ZAPO_WS_CA_PUB", "");

/** One client per session, all over the SAME store bundle. `sessionId` is
 * the only thing that differs, and it is what the store qualifies every row
 * by. */
function newClient(id: string): WaClient {
  return new WaClient({
    store: rootStore,
    sessionId: id,
    connectTimeoutMs: envNum("ZAPO_CONNECT_TIMEOUT_MS", 30000),
    deviceBrowser: envStr("ZAPO_DEVICE_BROWSER", "Chrome"),
    deviceOsDisplayName: envStr("ZAPO_DEVICE_OS", "Windows"),
    /* ZAPO_WS_URL points the client at a non-default endpoint. Used to drive
     * the binary against a local fake server for verification; leave unset
     * for real WhatsApp. */
    chatSocketUrls: envStr("ZAPO_WS_URL", "") !== "" ? [envStr("ZAPO_WS_URL", "")] : undefined,
    testHooks:
      WS_CA_PUB !== ""
        ? { noiseRootCa: { publicKey: hexToBytes(WS_CA_PUB), serial: envNum("ZAPO_WS_CA_SERIAL", 0) } }
        : undefined,
  });
}

function wireEvents(sess: Session): void {
  const tag = `[${sess.id}]`;
  const c = sess.client;
  c.on("auth_qr", (e) => {
    sess.qr = e.qr;
    sess.qrTtlMs = e.ttlMs;
    sess.qrAt = Date.now();
    push(sess, "auth_qr", { qr: e.qr, ttlMs: e.ttlMs });
    console.log(`${tag} [qr] ttlMs=${e.ttlMs}`);
    console.log(`${tag} [qr] ${e.qr}`);
  });
  c.on("auth_pairing_code", (e) => {
    sess.pairingCode = e.code;
    push(sess, "auth_pairing_code", { code: e.code });
    console.log(`${tag} [pairing-code] ${e.code}`);
  });
  c.on("auth_pairing_required", (e) => {
    push(sess, "auth_pairing_required", { forceManual: e.forceManual });
  });
  c.on("auth_paired", () => {
    sess.qr = null;
    push(sess, "auth_paired", { paired: true });
    console.log(`${tag} [auth] paired`);
  });
  c.on("connection", (e) => {
    sess.lastEventSaidOpen = e.status === "open";
    sess.lastConnectionEvent = e;
    if (sess.lastEventSaidOpen) sess.qr = null;
    push(sess, "connection", e);
    console.log(`${tag} [connection] ${e.status} reason=${String(e.reason)}`);
  });
  c.on("message", (e) => {
    sess.recv += 1;
    push(sess, "message", e);
    rememberMessage(sess, sess.seq, e);
  });
  c.on("message_send", (e) => {
    sess.sent += 1;
    push(sess, "message_send", e);
  });
  c.on("receipt", (e) => {
    push(sess, "receipt", e);
  });
  c.on("presence", (e) => {
    push(sess, "presence", e);
  });
  c.on("chatstate", (e) => {
    push(sess, "chatstate", e);
  });
  c.on("call", (e) => {
    push(sess, "call", e);
  });
  c.on("group", (e) => {
    push(sess, "group", e);
  });
  c.on("newsletter", (e) => {
    push(sess, "newsletter", e);
  });
  c.on("stream_failure", (e) => {
    push(sess, "stream_failure", e);
  });
  c.on("stanza_error", (e) => {
    push(sess, "stanza_error", e);
  });
  c.on("auth_passkey_required", (e) => {
    push(sess, "auth_passkey_required", e);
    console.log(`${tag} [auth] a passkey is required to link this device (signer configured: ${e.hasSigner ? "yes" : "no"})`);
  });
  c.on("message_addon", (e) => {
    push(sess, "message_addon", e);
  });
  c.on("message_bot_chunk", (e) => {
    push(sess, "message_bot_chunk", e);
  });
  c.on("message_protocol", (e) => {
    push(sess, "message_protocol", e);
  });
  c.on("message_unavailable", (e) => {
    push(sess, "message_unavailable", e);
  });
  c.on("newsletter_message_update", (e) => {
    push(sess, "newsletter_message_update", e);
  });
  c.on("mex_notification", (e) => {
    push(sess, "mex_notification", e);
  });
  c.on("business", (e) => {
    push(sess, "business", e);
  });
  c.on("picture", (e) => {
    push(sess, "picture", e);
  });
  c.on("history_sync_chunk", (e) => {
    /* A history-sync chunk can be very large; record that it arrived and how
     * big it was rather than parking the whole payload in the ring. */
    push(sess, "history_sync_chunk", { received: true, progress: e.progress, syncType: e.syncType });
  });
  c.on("offline_resume", (e) => {
    push(sess, "offline_resume", e);
  });
  c.on("mobile_registration_code", (e) => {
    push(sess, "mobile_registration_code", e);
  });
  c.on("mobile_account_takeover_notice", (e) => {
    push(sess, "mobile_account_takeover_notice", e);
  });
  c.on("companion_host_linked", (e) => {
    push(sess, "companion_host_linked", e);
  });
  c.on("companion_host_revoked", (e) => {
    push(sess, "companion_host_revoked", e);
  });
  c.on("companion_host_error", (e) => {
    push(sess, "companion_host_error", e);
  });
}

function startConnect(sess: Session): void {
  if (sess.connectStarted || sess.stopped) return;
  sess.connectStarted = true;
  sess.client.connect().then(
    () => {
      console.log(`[${sess.id}] [connect] resolved`);
    },
    (err: unknown) => {
      sess.connectStarted = false;
      push(sess, "connect_error", { error: String(err) });
      console.log(`[${sess.id}] [connect] failed: ${String(err)}`);
    },
  );
}

/** Builds the in-process session and wires it up. Does NOT touch the
 * database: the registry row and the credential load are separate steps, so
 * a session can be constructed before the connection is open. */
function makeSession(id: string): Session {
  const sess: Session = {
    id: id,
    client: newClient(id),
    store: rootStore.session(id),
    createdMs: Date.now(),
    events: [],
    msgSeqs: [],
    msgEvents: [],
    seq: 0,
    qr: null,
    qrTtlMs: 0,
    qrAt: 0,
    pairingCode: null,
    lastEventSaidOpen: false,
    lastConnectionEvent: null,
    connectStarted: false,
    sent: 0,
    recv: 0,
    ready: false,
    error: null,
    hasCredentials: false,
    stopped: false,
  };
  wireEvents(sess);
  sessions.push(sess);
  return sess;
}

/* The service's OWN table, in the same DATABASE, so the set of sessions
 * survives a restart even before any of them has written a credential row.
 * It is not part of zapo's schema and zapo never reads it; store-mysql's
 * migration runner only creates and versions its own 22 tables plus
 * `_migrations`.
 *
 * The column types follow store-mysql's own conventions rather than a
 * transliteration of the SQLite DDL: TEXT PRIMARY KEY is not indexable in
 * MySQL without a prefix length, so session_id is VARCHAR(255) -- the same
 * width and charset every one of the store's own session_id columns uses --
 * and the INTEGERs become BIGINT (a millisecond epoch overflows INT in 1970)
 * and TINYINT. */
async function ensureRegistryTable(c: MysqlExec): Promise<void> {
  await sqlRun(
    c,
    "CREATE TABLE IF NOT EXISTS `zapo_rest_sessions` (" +
      "session_id VARCHAR(255) NOT NULL," +
      "created_ms BIGINT NOT NULL," +
      "autoconnect TINYINT NOT NULL DEFAULT 1," +
      "label VARCHAR(255)," +
      "PRIMARY KEY (session_id)" +
      ") ENGINE=InnoDB DEFAULT CHARSET=utf8mb4",
    [],
  );
}

/* ONE statement, where the SQLite build used SELECT-then-INSERT/UPDATE.
 *
 * That build justified its two statements with "a synchronous driver, so
 * there is no window between them". That is true of one SQLite handle and
 * FALSE of a pool: two awaits can land on two physical connections with
 * another request interleaved between them, so the SELECT-then-write shape
 * would acquire a race here that it did not have there. MySQL has had
 * ON DUPLICATE KEY UPDATE since 4.1 and the SQLite build's stated reason for
 * avoiding the upsert clause -- that the vendored SQLite might predate 3.24
 * -- has no counterpart. The observable behaviour is unchanged. */
async function registryUpsert(id: string, autoconnect: boolean, label: string | undefined): Promise<void> {
  const c = db();
  const lbl = label === undefined ? null : label;
  await sqlRun(
    c,
    "INSERT INTO `zapo_rest_sessions` (session_id, created_ms, autoconnect, label) VALUES (?, ?, ?, ?) " +
      "ON DUPLICATE KEY UPDATE autoconnect = VALUES(autoconnect), label = VALUES(label)",
    [id, Date.now(), autoconnect ? 1 : 0, lbl],
  );
}

async function registryDelete(id: string): Promise<void> {
  await sqlRun(db(), "DELETE FROM `zapo_rest_sessions` WHERE session_id = ?", [id]);
}

interface RegistryRow extends Record<string, unknown> {
  readonly session_id: unknown;
  readonly created_ms: unknown;
  readonly autoconnect: unknown;
  readonly label: unknown;
}

/** Row counts for ONE session, straight off the shared pool: one
 * `COUNT(*) ... WHERE session_id = ?` per domain table. This is the
 * instrument the isolation probe reads. */
async function rowsFor(id: string): Promise<Bag> {
  const c = db();
  const have = await listTables(c);
  const out: Bag = {};
  for (const t of SESSION_TABLES) {
    if (!hasTable(have, t)) continue;
    const one = await sqlGet(c, `SELECT COUNT(*) AS n FROM ${ident(t)} WHERE session_id = ?`, [id]);
    out[t] = countOf(one, "n");
  }
  return out;
}

/** The whole set of session ids the DATABASE knows about, regardless of
 * whether the service has a client for them: the registry table, plus every
 * distinct session_id in any domain table. A session that was created by an
 * older build, or whose registry row was removed while its data stayed,
 * still shows up here. */
function addId(out: string[], v: unknown): void {
  if (typeof v !== "string") return;
  if (v === "") return;
  for (const seen of out) {
    if (seen === v) return;
  }
  out.push(v);
}

async function knownIds(c: MysqlExec): Promise<string[]> {
  const out: string[] = [];
  const have = await listTables(c);
  if (hasTable(have, "zapo_rest_sessions")) {
    for (const r of await sqlAll(c, "SELECT session_id FROM `zapo_rest_sessions` ORDER BY created_ms", [])) {
      addId(out, r["session_id"]);
    }
  }
  for (const t of SESSION_TABLES) {
    if (!hasTable(have, t)) continue;
    for (const r of await sqlAll(c, `SELECT DISTINCT session_id FROM ${ident(t)}`, [])) {
      addId(out, r["session_id"]);
    }
  }
  return out;
}

/** Deletes every row this session owns, in ONE transaction, and reports the
 * per-table counts it removed. Only reachable from
 * `POST /sessions/remove?purge=1`.
 *
 * The SQLite build handed a SYNCHRONOUS task to `runInTransaction` -- its
 * signature refuses a promise outright. Here every statement is a round
 * trip, so the transaction has to be held open across awaits on ONE pooled
 * connection, which is exactly what BaseMysqlStore.withTransaction does and
 * is the only shape that is actually a transaction on a pool: running the
 * DELETEs through the pool would scatter them over N connections and
 * BEGIN would apply to whichever one got it. */
async function purgeRows(id: string): Promise<Bag> {
  const before = await rowsFor(id);
  const have = await listTables(db());
  const tx = await db().getConnection();
  try {
    await tx.beginTransaction();
    for (const t of SESSION_TABLES) {
      if (!hasTable(have, t)) continue;
      await tx.execute(`DELETE FROM ${ident(t)} WHERE session_id = ?`, [id]);
    }
    await tx.commit();
  } catch (err: unknown) {
    await tx.rollback();
    tx.release();
    throw err;
  }
  tx.release();
  const after = await rowsFor(id);
  const deleted: Bag = {};
  for (const t of SESSION_TABLES) {
    const b = before[t];
    const a = after[t];
    const bn = typeof b === "number" ? b : 0;
    const an = typeof a === "number" ? a : 0;
    if (bn - an !== 0 || bn !== 0) deleted[t] = bn - an;
  }
  return { before: before, after: after, deleted: deleted };
}

/** Stops a session's client and drops it from the registry. Rows are NOT
 * touched -- see the `purge` parameter on POST /sessions/remove. */
async function stopSession(sess: Session): Promise<void> {
  sess.stopped = true;
  sess.connectStarted = false;
  try {
    await sess.client.disconnect();
  } catch (err: unknown) {
    console.log(`[${sess.id}] [remove] disconnect failed (continuing): ${String(err)}`);
  }
  /* Releases the sessionId inside zapo's store so a later create() builds a
   * fresh bundle. The per-domain destroy() on MySQL clears the migration
   * latch and nothing else -- BaseMysqlStore.destroy() does not touch the
   * pool, which this program owns -- so another live session keeps working
   * across this call, as it did on SQLite for a different reason (there the
   * destroy was a refcount decrement on a shared handle). */
  stopCleanupFor(sess.id);
  try {
    await sess.store.destroy();
  } catch (err: unknown) {
    console.log(`[${sess.id}] [remove] store teardown failed (continuing): ${String(err)}`);
  }
  const keep: Session[] = [];
  for (const s of sessions) {
    if (s.id !== sess.id) keep.push(s);
  }
  sessions = keep;
}

/** The per-session boot step: load credentials (which creates and migrates
 * the schema on a fresh database) and, if asked, start connecting. */
function initSession(sess: Session, autoconnect: boolean): void {
  sess.store.auth.load().then(
    (creds) => {
      sess.ready = true;
      sess.hasCredentials = creds !== null;
      /* MYSQL ONLY. The five cache domains hold rows with an expiry column
       * and nothing prunes them: store-sqlite evicts on read, store-mysql
       * needs this poller or the cache tables grow for the life of the
       * database. Started here, after the first store read has proven the
       * schema, and stopped in stopSession. There is no SQLite counterpart
       * to this timer, so it is a declared divergence and not a port. */
      startCleanupFor(sess.id);
      console.log(
        `  session ${sess.id}: ready, ${creds !== null ? "PAIRED (credentials found)" : "unpaired (scan the QR)"}`,
      );
      if (autoconnect) startConnect(sess);
    },
    (err: unknown) => {
      sess.error = String(err);
      console.log(`  session ${sess.id}: FAILED to load: ${String(err)}`);
    },
  );
}

/* ── HTTP ──────────────────────────────────────────────────────────────── */

function send(res: ServerResponse, status: number, payload: unknown): void {
  const body = safeJson(payload);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  res.end(body);
}

/** Classify a thrown value. A deferred static-lowering refusal carries an
 * [SCxxxx] marker; that is a 501 naming the construct, not a 500. */
function fail(res: ServerResponse, err: unknown): void {
  const text = err instanceof Error ? err.message : String(err);
  const scAt = text.indexOf("[SC");
  if (scAt !== -1) {
    const close = text.indexOf("]", scAt);
    const marker = close === -1 ? text.slice(scAt) : text.slice(scAt, close + 1);
    send(res, 501, {
      error: "not_implemented",
      reason: "this zapo method has no static lowering in the compiler; the compiled binary defers it to a runtime refusal",
      diagnostic: marker,
      detail: text,
    });
    return;
  }
  if (text.indexOf("missing required") === 0) {
    send(res, 400, { error: "bad_request", detail: text });
    return;
  }
  /* The registry routes reach a session by name too, so they raise the same
   * two conditions the dispatcher classifies, and they must answer with the
   * same statuses: an unknown session is 404, a malformed id is 400. */
  if (text.indexOf("no such session") === 0) {
    send(res, 404, { error: "no_such_session", detail: text });
    return;
  }
  if (text.indexOf("invalid session id") === 0) {
    send(res, 400, { error: "bad_session_id", detail: text });
    return;
  }
  send(res, 500, { error: "error", detail: text });
}


/* ── sessions ──────────────────────────────────────────────────────────── */

/** One session's live summary. Cheap: no database read unless the caller
 * asks for `rows`. */
function summarize(sess: Session): Bag {
  const st = sess.client.getState();
  return {
    id: sess.id,
    live: true,
    createdMs: sess.createdMs,
    ready: sess.ready,
    error: sess.error,
    /* credentials ROW present in the store -- this is what proves the
     * session survived a restart. It is NOT "linked to a phone": that is
     * state.registered, which stays false until the QR is scanned. */
    hasCredentials: sess.hasCredentials,
    paired: st.registered,
    connected: st.connected,
    lastEventSaidOpen: sess.lastEventSaidOpen,
    hasQr: sess.qr !== null,
    qrAgeMs: sess.qrAt === 0 ? null : Date.now() - sess.qrAt,
    hasPairingCode: st.hasPairingCode,
    connectStarted: sess.connectStarted,
    lastConnection: sess.lastConnectionEvent,
    counts: { sent: sess.sent, received: sess.recv, events: sess.events.length, seq: sess.seq },
  };
}

/** The registry surface. These four routes are SERVICE-level: they are never
 * addressed to a session, and `/s/<id>/sessions...` is not a thing. */
async function registryRoute(method: string, path: string, p: Bag): Promise<unknown> {
  if (path === "/sessions") {
    const withRows = bool(p, "rows") === true;
    const out: Bag[] = [];
    const live: string[] = [];
    for (const s of sessions) {
      const row = summarize(s);
      if (withRows) row["rows"] = await rowsFor(s.id);
      out.push(row);
      live.push(s.id);
    }
    /* Sessions the DATABASE knows about but this process has no client for:
     * removed with their rows kept, or written by an older run. */
    if (conn !== null) {
      for (const id of await knownIds(conn)) {
        let isLive = false;
        for (const l of live) {
          if (l === id) isLive = true;
        }
        if (isLive) continue;
        const row: Bag = { id: id, live: false, note: "rows exist in the database; no client is running for it" };
        if (withRows) row["rows"] = await rowsFor(id);
        out.push(row);
      }
    }
    return {
      dsn: DB_DSN,
      ignoredDbPath: IGNORED_DB_PATH === "" ? null : IGNORED_DB_PATH,
      defaultSession: DEFAULT_SESSION,
      addressing: "/s/<sessionId>/<route>; an unprefixed /<route> is addressed to the default session",
      push: {
        route: `/s/<sessionId>${WS_ROUTE}`,
        protocol: "websocket (RFC 6455); one JSON text frame per event, the same object GET /events returns",
        params: "?since=<seq> replays from the ring (absent = live only), ?type=<name> filters, ?token= when ZAPO_REST_TOKEN is set",
        ack: "{\"ack\":<seq>}",
        window: WS_WINDOW,
        lagCloseMs: WS_LAG_MS,
        subscribers: wsSubs.length,
        note: "the service keeps NO per-subscriber buffer; a consumer that stops acking stops being sent to and is closed with 1013, then reconnects with ?since=",
      },
      idSpelling: ID_SPELLING,
      ready: storeReady,
      storeError: storeError,
      connection: {
        database: MYSQL_DATABASE,
        shared: true,
        poolSize: POOL_SIZE,
        note: "one mysql2 pool serves every session, by construction: this program builds it and hands the SAME object to createMysqlStore, so there is no connection cache to miss. GET /sessions/connection measures the consequence, not the fact.",
      },
      liveCount: sessions.length,
      count: out.length,
      sessions: out,
    };
  }

  if (path === "/sessions/create") {
    const id = reqStr(p, "id");
    if (!idOk(id)) throw new Error(`invalid session id '${id}'; expected ${ID_SPELLING}`);
    const autoconnect = bool(p, "autoconnect") !== false;
    const label = str(p, "label");
    const existing = findSession(id);
    if (existing !== undefined) {
      await registryUpsert(id, autoconnect, label);
      return { created: false, existing: true, session: summarize(existing) };
    }
    const sess = makeSession(id);
    await registryUpsert(id, autoconnect, label);
    initSession(sess, autoconnect);
    return {
      created: true,
      id: id,
      autoconnect: autoconnect,
      session: summarize(sess),
      next: autoconnect
        ? `poll GET /s/${id}/qr for the pairing QR, then GET /s/${id}/health`
        : `POST /s/${id}/connect to start, then poll GET /s/${id}/qr`,
    };
  }

  if (path === "/sessions/remove") {
    const id = reqStr(p, "id");
    if (!idOk(id)) throw new Error(`invalid session id '${id}'; expected ${ID_SPELLING}`);
    const sess = findSession(id);
    let onFile = false;
    if (conn !== null) {
      for (const k of await knownIds(conn)) {
        if (k === id) onFile = true;
      }
    }
    if (sess === undefined && !onFile) throw new Error(`no such session '${id}'`);
    /* DELETION IS NOT THE DEFAULT. Without purge=1 this stops the client and
     * drops the registry row, and every one of the session's rows stays in
     * the database -- so re-creating the same id resumes the same paired
     * WhatsApp account. purge=1 additionally DELETEs the session's rows from
     * all 22 domain tables, which is irreversible and un-pairs it. */
    const purge = bool(p, "purge") === true;
    if (sess !== undefined) await stopSession(sess);
    if (conn !== null) await registryDelete(id);
    if (!purge) {
      return {
        removed: true,
        id: id,
        stoppedClient: sess !== undefined,
        registryRowDeleted: conn !== null,
        rowsDeleted: false,
        rowsKept: conn === null ? null : await rowsFor(id),
        note: "the client is stopped and the registry row is gone; every data row is KEPT. Pass purge=1 to delete them.",
      };
    }
    const purged = await purgeRows(id);
    return {
      removed: true,
      id: id,
      stoppedClient: sess !== undefined,
      registryRowDeleted: conn !== null,
      rowsDeleted: true,
      purge: purged,
      note: "purge=1 was given: every row this session owned was DELETEd from all 22 domain tables",
    };
  }

  if (path === "/sessions/rows") {
    const id = reqStr(p, "id");
    if (!idOk(id)) throw new Error(`invalid session id '${id}'; expected ${ID_SPELLING}`);
    return { id: id, rows: await rowsFor(id) };
  }

  if (path === "/sessions/second") {
    /* Opens and WARMS a SECOND POOL, then leaves it alone.
     *
     * The idle release claims to be per handle: a service holding several
     * databases should hand back what the ones sitting still are holding and
     * keep what the one being queried holds. An aggregate window count cannot
     * show that -- it says one release and one skip happened, not which
     * handle was which -- so this route supplies the second handle to see.
     *
     * The SQLite build had to MANUFACTURE its second handle: it varied
     * cache_size by one KiB so `openSqliteConnection`'s process-wide cache
     * would miss. A pool needs no such trick, so the arm is simply a second
     * pool -- but that also means the two are not holding the same KIND of
     * memory the SQLite pair was. There, both handles held page cache in
     * THIS process. Here the page cache is the server's and what these two
     * pools hold is per-connection packet buffers. The arm is therefore a
     * measurement of a DIFFERENT quantity that happens to share a route
     * name, and a reader comparing it to the SQLite figure is comparing two
     * unlike things. It is reported with that said in the payload.
     *
     * Warming matters either way: a handle with nothing in it would be
     * released with nothing to give back, and the arm would pass while
     * measuring nothing. */
    if (secondPool === null) {
      secondPool = createMysqlPool({
        host: MYSQL_HOST,
        port: MYSQL_PORT,
        user: MYSQL_USER,
        password: MYSQL_PASSWORD,
        database: MYSQL_DATABASE,
        connectionLimit: POOL_SIZE,
        waitForConnections: true,
      }) as unknown as MysqlPool;
    }
    const sp = secondPool;
    const have = await listTables(sp);
    let warmed = 0;
    for (const t of SESSION_TABLES) {
      if (!hasTable(have, t)) continue;
      const one = await sqlGet(sp, `SELECT COUNT(*) AS n FROM ${ident(t)}`, []);
      warmed += countOf(one, "n");
    }
    return {
      second: true,
      warmedRows: warmed,
      poolSize: POOL_SIZE,
      holds: "per-connection client buffers, NOT a page cache: InnoDB's buffer pool is the server's and is not duplicated by a second pool",
      note: "a second mysql2 pool on the same database, warmed and then left idle",
    };
  }

  if (path === "/sessions/cycleburst") {
    /* FORCES a cycle-collector pass, which is the only thing that reaches the
     * arena's page-return sweep.
     *
     * WHY A BURST OF GARBAGE AND NOT A DIRECT CALL. scr_cyc_pr_sweep() is
     * static in scr_cycle.c and there is no binding that reaches it from here.
     * But the sweep hangs off the END of a collector pass (scr_cycle.c), and
     * the collector is triggered from scr_cyc_on_release when buffered roots
     * cross a threshold -- so making and dropping cyclic objects is a
     * SUPPORTED way to make the pass happen, using nothing but the language.
     *
     * This route is entirely store-agnostic and is carried over unchanged
     * from the SQLite build, deliberately: it is the one route on which the
     * two programs must agree exactly, because it is the positive control
     * for the collector in both.
     *
     * IT IS ITS OWN POSITIVE CONTROL. If the [pgret] sweep count does not rise
     * above the no-burst figure, this route did not trigger a pass and any
     * memory delta measured around it means nothing -- so the counter must be
     * read, not assumed.
     *
     * Inert: it fires on nothing and allocates nothing until called, which is
     * what lets both arms be the SAME binary with calling it as the only knob. */
    const n = num(p, "n") !== undefined ? reqNum(p, "n") : 50000;
    let sum = 0;
    for (let i = 0; i < n; i++) {
      const node: { self: unknown; pad: number } = { self: null, pad: i };
      node.self = node; /* the self-reference is what makes it the collector's problem */
      sum += node.pad;
    }
    return {
      burst: n,
      sum: sum,
      note: "read [pgret] sweeps: if it did not rise, no pass ran and no delta around this call is meaningful",
    };
  }

  if (path === "/sessions/shrink") {
    /* A DECLARED NO-OP. There is nothing here to shrink, and this route
     * exists to say so at the same address rather than 404.
     *
     * The SQLite build issued `PRAGMA shrink_memory`, which is
     * sqlite3_db_release_memory() and frees every UNPINNED page of THIS
     * PROCESS's page cache back to the C allocator. The whole route rested
     * on the page cache being in-process. Under MySQL it is not: InnoDB's
     * buffer pool is the server's, it is not this process's to release, and
     * releasing it would be releasing it for every other client of that
     * server.
     *
     * What this process does hold for the database is the pool's
     * per-connection buffers, and mysql2 exposes no API to release them
     * while keeping the pool usable -- `pool.end()` closes it for good,
     * which is not a shrink. So nothing is called. The route reports
     * supported:false and the server-side figures it CAN honestly know,
     * read once at startup; a caller that reads a 200 here and records a
     * shrink would be recording an event that did not happen, which is why
     * the flag is in the payload and not merely in this comment. */
    return {
      pragma: null,
      supported: false,
      ms: 0,
      poolSize: POOL_SIZE,
      reason: "InnoDB's buffer pool belongs to the server, not to this process; mysql2 exposes no buffer release that keeps the pool usable. Nothing was called.",
      server: serverFacts,
      sqliteCounterpart: "PRAGMA shrink_memory -> sqlite3_db_release_memory(), which has no MySQL client analogue",
    };
  }

  if (path === "/sessions/connection") {
    /* THE SQLITE ROUTE'S QUESTION DOES NOT EXIST HERE, AND THIS IS ITS
     * REPLACEMENT -- a different probe, of the thing that actually matters.
     *
     * What the SQLite route proved: that one better-sqlite3 Database served
     * every session, by writing a token into a TEMP table (private to one
     * connection) through the service's handle and reading it back through a
     * handle opened with the stores' exact options. It needed proving because
     * `openSqliteConnection` keys a process-wide cache on
     * driver|path|pragmas|tableNames, and getting the options wrong silently
     * bought a second connection to the same file.
     *
     * That question is GONE, two ways at once. There is no connection cache
     * to miss -- this program builds the pool and hands the same object to
     * createMysqlStore -- so the answer is true by construction and a probe
     * of it would be green by construction too. And the answer to "is it one
     * connection" is NO on purpose: a pool is up to POOL_SIZE connections and
     * a statement does not choose which one it lands on.
     *
     * So the probe measures the CONSEQUENCE the SQLite route was ultimately
     * about: does a write issued by the service become visible to a read the
     * stores would make, even though the two land on different physical
     * connections? Under MySQL that holds because the state is the server's,
     * not the handle's -- the exact inverse of the SQLite fact.
     *
     * AND IT CARRIES A NEGATIVE CONTROL, which is the whole reason it is
     * worth running. CREATE TEMPORARY TABLE in MySQL is also private to one
     * connection. If the control's temp row is visible from every later
     * pooled statement as reliably as the committed row is, then every
     * statement landed on ONE connection, the probe cannot discriminate, and
     * the "different connections" half of the verdict is unsupported.
     * CONNECTION_ID() is reported for every probe so the reader can see the
     * spread rather than take the verdict's word for it.
     *
     * THE PROBES ARE FIRED CONCURRENTLY, and that is load-bearing. A pool
     * hands a sequential caller the SAME connection every time -- it only
     * grows when a second statement arrives while the first is still in
     * flight. MEASURED on the first smoke run: issued in sequence, all
     * fourteen statements landed on connection id 12, the temporary table
     * was therefore visible to every one of them, and the route correctly
     * reported INCONCLUSIVE rather than claiming the result. Promise.all is
     * what makes the pool actually hand out distinct connections, so the
     * control can discriminate. The INCONCLUSIVE arm is kept: if the pool
     * still does not grow, this route must say so and not guess. */
    const c = db();
    const token = Date.now();

    /* A real row, through the shared pool, into a table of THIS ROUTE'S OWN.
     *
     * NOT into zapo_rest_sessions, which was the first shape of this probe.
     * Every id in that table becomes a live session at the next startup
     * (initStore makes one for each), and '__connprobe__' passes idOk -- so a
     * crash or a timeout between the INSERT and the DELETE below would leave
     * a row that silently becomes a WhatsApp session on the next boot. A
     * separate table cannot do that, and it costs one more CREATE TABLE IF
     * NOT EXISTS on a route nothing in the measured path calls. */
    await sqlRun(
      c,
      "CREATE TABLE IF NOT EXISTS `zapo_rest_connprobe_committed` (" +
        "k VARCHAR(32) NOT NULL, n BIGINT NOT NULL, PRIMARY KEY (k)" +
        ") ENGINE=InnoDB DEFAULT CHARSET=utf8mb4",
      [],
    );
    await sqlRun(
      c,
      "INSERT INTO `zapo_rest_connprobe_committed` (k, n) VALUES (?, ?) " +
        "ON DUPLICATE KEY UPDATE n = VALUES(n)",
      ["probe", token],
    );
    /* The per-connection control, planted on whichever connection serves
     * these three statements. Which one that is does not matter; that it is
     * exactly ONE of them is the point. */
    let plantErr: string | null = null;
    try {
      await sqlRun(c, "CREATE TEMPORARY TABLE IF NOT EXISTS `zapo_rest_connprobe` (n BIGINT)", []);
      await sqlRun(c, "DELETE FROM `zapo_rest_connprobe`", []);
      await sqlRun(c, "INSERT INTO `zapo_rest_connprobe` (n) VALUES (?)", [token]);
    } catch (err: unknown) {
      plantErr = String(err);
    }

    interface Probe {
      readonly connectionId: number;
      readonly sawCommitted: boolean;
      readonly sawTemporary: boolean;
      readonly error: string | null;
    }
    async function oneProbe(): Promise<Probe> {
      let cid = 0;
      let sawCommitted = false;
      let sawTemporary = false;
      let error: string | null = null;
      try {
        cid = countOf(await sqlGet(c, "SELECT CONNECTION_ID() AS n", []), "n");
        const r = await sqlGet(c, "SELECT n FROM `zapo_rest_connprobe_committed` WHERE k = ?", ["probe"]);
        sawCommitted = countOf(r, "n") === token;
      } catch (err: unknown) {
        error = String(err);
      }
      try {
        const r = await sqlGet(c, "SELECT n FROM `zapo_rest_connprobe`", []);
        sawTemporary = countOf(r, "n") === token;
      } catch (err: unknown) {
        /* "table doesn't exist" IS the expected answer on another
         * connection. It is a result, not a failure, and it is not recorded
         * as an error for that reason. */
        sawTemporary = false;
      }
      return { connectionId: cid, sawCommitted: sawCommitted, sawTemporary: sawTemporary, error: error };
    }

    /* CONCURRENTLY. See the note above: a sequential caller gets one
     * connection and the control cannot discriminate. */
    const pending: Promise<Probe>[] = [];
    for (let i = 0; i < POOL_SIZE + 2; i += 1) pending.push(oneProbe());
    const results = await Promise.all(pending);

    const idsSeen: number[] = [];
    const distinct: number[] = [];
    let committedHits = 0;
    let temporaryHits = 0;
    let probeErr: string | null = null;
    for (const r of results) {
      idsSeen.push(r.connectionId);
      let seen = false;
      for (const d of distinct) {
        if (d === r.connectionId) seen = true;
      }
      if (!seen) distinct.push(r.connectionId);
      if (r.sawCommitted) committedHits += 1;
      if (r.sawTemporary) temporaryHits += 1;
      if (r.error !== null) probeErr = r.error;
    }
    const n = results.length;

    await sqlRun(c, "DELETE FROM `zapo_rest_connprobe_committed` WHERE k = ?", ["probe"]);

    return {
      probe: "a MySQL TEMPORARY table is private to one connection; a committed row is not",
      replaces: "the SQLite build's one-connection proof, whose question (did the connection cache hit?) has no MySQL counterpart",
      token: token,
      poolSize: POOL_SIZE,
      probes: n,
      issuedConcurrently: true,
      serverConnectionIds: { seen: idsSeen, distinct: distinct.length },
      committedRow: { seenBy: committedHits, of: n, error: probeErr },
      temporaryTableControl: { seenBy: temporaryHits, of: n, plantError: plantErr },
      verdict:
        distinct.length <= 1
          ? "INCONCLUSIVE: every probe landed on ONE connection (the pool did not grow), so the per-connection control cannot discriminate and this run proves nothing about cross-connection visibility"
          : temporaryHits >= n
            ? "INCONCLUSIVE: the per-connection control was visible to EVERY probe despite several connections, so the probe does not discriminate"
            : committedHits >= n && temporaryHits < n
              ? "SHARED SUBSTRATE, MANY CONNECTIONS: every probe saw the committed write, the per-connection control did not reach them all, and the probes ran on several connections -- so the control discriminates and the stores and the service are on one database through one pool"
              : "NOT SHARED: a committed write was not visible to every probe, which should be impossible on one database -- treat the pool configuration as suspect",
      cite: "createMysqlStore takes `pool: Pool | PoolOptions` and passes the same object into every BaseMysqlStore; this program builds the pool and hands it over, so the sharing is structural and only its consequence is measured here",
    };
  }

  return undefined;
}

/* Route table. Each entry answers a value (or a promise of one) which is
 * serialized as {"ok":true,"result":...}. */
async function route(method: string, path: string, p: Bag, sess: Session): Promise<unknown> {
  /* ── service ────────────────────────────────────────────────────────── */
  if (path === "/shutdown") {
    if (!ALLOW_SHUTDOWN) {
      return { stopping: false, note: "set ZAPO_REST_ALLOW_SHUTDOWN=1 to enable /shutdown" };
    }
    const code = num(p, "code") !== undefined ? reqNum(p, "code") : 0;
    setTimeout(() => {
      console.log(`[shutdown] exiting with code ${code}`);
      process.exit(code);
    }, SHUTDOWN_DELAY_MS);
    return { stopping: true, code, afterMs: SHUTDOWN_DELAY_MS };
  }
  if (path === "/health") {
    /* NO DATABASE ROUND TRIP. The rig polls this route in its readiness loop
     * and again during the measured window; a query here would be a workload
     * difference between the two arms rather than a measurement of one. The
     * server figures are the ones read once at startup. */
    return {
      ok: true,
      uptimeMs: Date.now() - STARTED_MS,
      store: {
        driver: "mysql",
        dsn: DB_DSN,
        database: MYSQL_DATABASE,
        sessionId: sess.id,
        /* ONE pool for the whole process, shared by every session, and
         * shared with the stores by construction rather than by a cache
         * hit -- see GET /sessions/connection. */
        sharedPool: true,
        poolSize: POOL_SIZE,
        sessionsLive: sessions.length,
        cleanupPollers: cleanupPollers.length,
        /* THE CACHE IS NOT OURS. The SQLite build reported `cacheKiB` here
         * because the page cache was a process allocation this program
         * capped. InnoDB's buffer pool is the server's, so the figure is
         * reported under `server` and labelled, and there is deliberately
         * no process-side cache number to put in its place. */
        cacheKiB: null,
        cacheOwner: "server",
        server: serverFacts,
        ignoredDbPath: IGNORED_DB_PATH === "" ? null : IGNORED_DB_PATH,
        ready: storeReady,
        error: storeError === null ? sess.error : storeError,
        /* credentials ROW present in the store -- this is what proves the
         * session survived a restart. It is NOT "linked to a phone": that is
         * state.registered, which stays false until the QR is scanned. */
        hasCredentials: sess.hasCredentials,
      },
      connection: {
        /* sess.client.getState() is authoritative; lastEventStatus is what the
         * most recent `connection` event said. They can disagree briefly --
         * the socket opens before the event is dispatched -- so both are
         * reported rather than one being presented as the truth. */
        connected: sess.client.getState().connected,
        lastEventSaidOpen: sess.lastEventSaidOpen,
        hasQr: sess.qr !== null,
        last: sess.lastConnectionEvent,
      },
      state: sess.client.getState(),
      counts: { sent: sess.sent, received: sess.recv, events: sess.events.length, seq: sess.seq },
    };
  }
  if (path === "/state") return sess.client.getState();
  if (path === "/qr") {
    return {
      sessionId: sess.id,
      qr: sess.qr,
      ttlMs: sess.qrTtlMs,
      issuedAt: sess.qrAt,
      ageMs: sess.qrAt === 0 ? null : Date.now() - sess.qrAt,
      pairingCode: sess.pairingCode,
    };
  }
  if (path === "/events") {
    return since(sess, str(p, "type") !== undefined ? reqStr(p, "type") : "", num(p, "since") !== undefined ? reqNum(p, "since") : 0, num(p, "limit") !== undefined ? reqNum(p, "limit") : 100);
  }
  if (path === "/messages") {
    return since(sess, "message", num(p, "since") !== undefined ? reqNum(p, "since") : 0, num(p, "limit") !== undefined ? reqNum(p, "limit") : 100);
  }
  if (path === "/connect") {
    startConnect(sess);
    return { sessionId: sess.id, starting: true, note: `connect() stays pending until pairing completes on a fresh session; poll /s/${sess.id}/qr and /s/${sess.id}/health` };
  }
  if (path === "/disconnect") {
    await sess.client.disconnect();
    sess.connectStarted = false;
    return { sessionId: sess.id, disconnected: true };
  }
  if (path === "/logout") {
    await sess.client.logout();
    return { loggedOut: true };
  }
  if (path === "/credentials") {
    const c = sess.client.getCredentials();
    if (c === null) return null;
    /* Never serialize the credential record: it holds private keys. */
    return { present: true, redacted: true, note: "credential material is deliberately not exposed over HTTP" };
  }
  if (path === "/clockSkewMs") return sess.client.getClockSkewMs();

  /* ── store reads ────────────────────────────────────────────────────── */
  if (path === "/store/threads") {
    return await sess.store.threads.list(num(p, "limit") !== undefined ? reqNum(p, "limit") : 100);
  }
  if (path === "/store/thread") {
    return await sess.store.threads.getByJid(reqStr(p, "jid"));
  }
  if (path === "/store/messages") {
    return await sess.store.messages.listByThread(
      reqStr(p, "thread"),
      num(p, "limit") !== undefined ? reqNum(p, "limit") : 50,
      num(p, "before"),
    );
  }
  if (path === "/store/message") {
    return await sess.store.messages.getById(reqStr(p, "id"));
  }
  if (path === "/store/contact") {
    const byPhone = str(p, "phone");
    if (byPhone !== undefined) return await sess.store.contacts.getByPhoneNumber(byPhone);
    return await sess.store.contacts.getByJid(reqStr(p, "jid"));
  }
  if (path === "/store/contacts") {
    /* WaContactStore exposes no list(); read the table directly, on the
     * SHARED pool -- and qualified by THIS session's id, which is what
     * keeps a raw read from crossing sessions the way a store read cannot.
     *
     * `username` is selected too: store-mysql's migration 0021 adds the
     * column and the SQLite program's six-column list predates it. */
    const limit = limitOf(num(p, "limit") !== undefined ? reqNum(p, "limit") : 200, 200);
    /* THE TABLE MAY NOT EXIST YET, and that is not an error here.
     *
     * store-sqlite's migration runner creates all of its tables in one pass
     * the first time any domain opens, so the SQLite build's raw read of
     * mailbox_contacts could never miss. store-mysql migrates PER DOMAIN and
     * lazily (BaseMysqlStore.ensureReady runs only the domains its own store
     * declares), so on a database where no contacts store has read yet, this
     * table genuinely does not exist. Letting that surface as a 500 would be
     * an A/B divergence created by the service, not by the store: the same
     * request against the SQLite arm returns an empty list. So the absence is
     * reported AS an empty list, with the reason, and the divergence stays
     * visible instead of becoming an error the comparison would have to
     * explain away. MEASURED: this fired on the first smoke run. */
    if (!(await tableExists(db(), "mailbox_contacts"))) {
      return {
        contacts: [],
        count: 0,
        tableExists: false,
        note: "mailbox_contacts has not been created yet: store-mysql migrates per domain, lazily, and no contacts store has read on this database. There are no contacts, which is also what the SQLite arm returns here.",
      };
    }
    return await sqlAll(
      db(),
      "SELECT jid, display_name, push_name, lid, phone_number, username, last_updated_ms " +
        `FROM \`mailbox_contacts\` WHERE session_id = ? ORDER BY last_updated_ms DESC LIMIT ${limit}`,
      [sess.id],
    );
  }
  if (path === "/store/tables") {
    /* information_schema, scoped to DATABASE(), where the SQLite build read
     * sqlite_master. Scoping matters: a MySQL server holds every other
     * database's tables in the same view, so an unscoped query would list
     * tables this service has nothing to do with. */
    const names = await listTables(db());
    const out: Bag[] = [];
    for (const n of names) out.push({ name: n });
    return out;
  }
  if (path === "/store/counts") {
    /* Two numbers per table: `total` is the whole database, `session` is the
     * rows THIS session owns. On a one-session database they are equal; the
     * moment they diverge, the gap is another session's rows -- which is
     * exactly what the isolation probe reads. `_migrations` is per-database
     * and has no session_id, so its `session` is reported as null rather
     * than as a zero that would look like a leak. */
    const c = db();
    const names = await listTables(c);
    const counts: Bag = {};
    for (const t of names) {
      const total = await sqlGet(c, `SELECT COUNT(*) AS n FROM ${ident(t)}`, []);
      if (!isSessionTable(t)) {
        counts[t] = { total: countOf(total, "n"), session: null };
        continue;
      }
      const mine = await sqlGet(c, `SELECT COUNT(*) AS n FROM ${ident(t)} WHERE session_id = ?`, [sess.id]);
      counts[t] = { total: countOf(total, "n"), session: countOf(mine, "n") };
    }
    return { sessionId: sess.id, tables: counts };
  }

  /* ── auth ───────────────────────────────────────────────────────────── */
  if (path === "/auth/getState") return sess.client.auth.getState(sess.lastEventSaidOpen);
  if (path === "/auth/loadOrCreateCredentials") {
    await sess.client.auth.loadOrCreateCredentials();
    return { loaded: true, redacted: true };
  }
  if (path === "/auth/requestPairingCode") {
    return await sess.client.auth.requestPairingCode(
      reqStr(p, "phoneNumber"),
      bool(p, "shouldShowPushNotification"),
      str(p, "customCode"),
    );
  }
  if (path === "/auth/fetchPairingCountryCodeIso") return await sess.client.auth.fetchPairingCountryCodeIso();
  if (path === "/auth/clearTransientState") {
    await sess.client.auth.clearTransientState();
    return { cleared: true };
  }
  if (path === "/auth/clearStoredCredentials") {
    await sess.client.auth.clearStoredCredentials();
    return { cleared: true };
  }
  if (path === "/auth/setNextConnectVersion") {
    sess.client.auth.setNextConnectVersion(reqStr(p, "version"));
    return { set: true };
  }
  if (path === "/auth/setNextConnectMobileAppVersion") {
    sess.client.auth.setNextConnectMobileAppVersion(reqStr(p, "appVersion"));
    return { set: true };
  }

  /* ── message ────────────────────────────────────────────────────────── */
  if (path === "/message/send") {
    const to = reqStr(p, "to");
    const text = str(p, "text");
    const content = obj(p, "content");
    const options = obj(p, "options");
    if (text !== undefined) {
      if (options !== undefined) return await sess.client.message.send(to, { type: "text", text: text }, options);
      return await sess.client.message.send(to, { type: "text", text: text });
    }
    if (content === undefined) throw new Error("missing required parameter 'text' or 'content'");
    /* zapo's content parameter is a DISCRIMINATED UNION and the request's
     * `content` is an open JSON object. There is no re-tag from one to the
     * other — the union's arms are distinct runtime shapes, and picking one
     * means reading the discriminant and BUILDING that arm, which is what
     * every dedicated route below does inline. So this route does it too,
     * on `content.type`, instead of handing the open record over. */
    const kind = str(content, "type");
    if (kind === undefined) {
      throw new Error("parameter 'content' needs a 'type' member (text|reaction|revoke|pin|unpin|poll|image|video|audio|document|sticker)");
    }
    /* One `send` per arm rather than one built value: the value would then
     * be a UNION of the arms, and a union crossing into another union is
     * the same re-tag this route exists to avoid. `{}` stands in for absent
     * options, which is zapo's own default. */
    const opts: Bag = options !== undefined ? options : {};
    if (kind === "text") {
      return await sess.client.message.send(to, { type: "text", text: reqStr(content, "text") }, opts);
    }
    if (kind === "reaction") {
      return await sess.client.message.send(to, { type: "reaction", emoji: reqStr(content, "emoji"), target: quoteRefOf(content) }, opts);
    }
    if (kind === "revoke") {
      return await sess.client.message.send(to, { type: "revoke", target: quoteRefOf(content) }, opts);
    }
    if (kind === "pin" || kind === "unpin") {
      return await sess.client.message.send(
        to,
        { type: kind === "unpin" ? "unpin" : "pin", durationSecs: num(content, "durationSecs"), target: quoteRefOf(content) },
        opts,
      );
    }
    if (kind === "poll") {
      return await sess.client.message.send(
        to,
        { type: "poll", name: reqStr(content, "name"), options: reqList(content, "options"), selectableCount: num(content, "selectableCount") },
        opts,
      );
    }
    if (kind === "image") {
      return await sess.client.message.send(to, { type: "image", media: reqStr(content, "media"), mimetype: str(content, "mimetype"), caption: str(content, "caption") }, opts);
    }
    if (kind === "video") {
      return await sess.client.message.send(to, { type: "video", media: reqStr(content, "media"), mimetype: str(content, "mimetype"), caption: str(content, "caption") }, opts);
    }
    if (kind === "audio") {
      return await sess.client.message.send(to, { type: "audio", media: reqStr(content, "media"), mimetype: str(content, "mimetype"), ptt: bool(content, "ptt") }, opts);
    }
    if (kind === "document") {
      return await sess.client.message.send(to, { type: "document", media: reqStr(content, "media"), mimetype: str(content, "mimetype"), fileName: str(content, "fileName") }, opts);
    }
    if (kind === "sticker") {
      return await sess.client.message.send(to, { type: "sticker", media: reqStr(content, "media"), mimetype: str(content, "mimetype") }, opts);
    }
    throw new Error(`content type '${kind}' is not one of text|reaction|revoke|pin|unpin|poll|image|video|audio|document|sticker`);
  }
  if (path === "/message/sendText") {
    return await sess.client.message.send(reqStr(p, "to"), { type: "text", text: reqStr(p, "text") });
  }
  if (path === "/message/reply") {
    return await sess.client.message.send(
      reqStr(p, "to"),
      { type: "text", text: reqStr(p, "text") },
      {
        quote: {
          remoteJid: reqStr(p, "quotedRemoteJid"),
          id: reqStr(p, "quotedId"),
          fromMe: bool(p, "quotedFromMe") === true,
          participant: str(p, "quotedParticipant"),
        },
      },
    );
  }
  if (path === "/message/react") {
    return await sess.client.message.send(reqStr(p, "to"), {
      type: "reaction",
      emoji: reqStr(p, "emoji"),
      target: {
        remoteJid: reqStr(p, "targetRemoteJid"),
        id: reqStr(p, "targetId"),
        fromMe: bool(p, "targetFromMe") === true,
        participant: str(p, "targetParticipant"),
      },
    });
  }
  if (path === "/message/revoke") {
    return await sess.client.message.send(reqStr(p, "to"), {
      type: "revoke",
      target: {
        remoteJid: reqStr(p, "targetRemoteJid"),
        id: reqStr(p, "targetId"),
        fromMe: bool(p, "targetFromMe") === true,
        participant: str(p, "targetParticipant"),
      },
    });
  }
  if (path === "/message/pin") {
    const dur = num(p, "durationSecs");
    return await sess.client.message.send(reqStr(p, "to"), {
      type: bool(p, "unpin") === true ? "unpin" : "pin",
      durationSecs: dur,
      target: {
        remoteJid: reqStr(p, "targetRemoteJid"),
        id: reqStr(p, "targetId"),
        fromMe: bool(p, "targetFromMe") === true,
        participant: str(p, "targetParticipant"),
      },
    });
  }
  if (path === "/message/poll") {
    return await sess.client.message.send(reqStr(p, "to"), {
      type: "poll",
      name: reqStr(p, "name"),
      options: reqList(p, "options"),
      selectableCount: num(p, "selectableCount"),
    });
  }
  if (path === "/message/sendMedia") {
    /* media is a filesystem path the server process can read. */
    const kind = reqStr(p, "type");
    const mediaPath = reqStr(p, "media");
    const to = reqStr(p, "to");
    if (kind === "image") {
      return await sess.client.message.send(to, { type: "image", media: mediaPath, mimetype: str(p, "mimetype"), caption: str(p, "caption") });
    }
    if (kind === "video") {
      return await sess.client.message.send(to, { type: "video", media: mediaPath, mimetype: str(p, "mimetype"), caption: str(p, "caption") });
    }
    if (kind === "audio") {
      return await sess.client.message.send(to, { type: "audio", media: mediaPath, mimetype: str(p, "mimetype"), ptt: bool(p, "ptt") });
    }
    if (kind === "document") {
      return await sess.client.message.send(to, { type: "document", media: mediaPath, mimetype: str(p, "mimetype"), fileName: str(p, "fileName") });
    }
    if (kind === "sticker") {
      return await sess.client.message.send(to, { type: "sticker", media: mediaPath, mimetype: str(p, "mimetype") });
    }
    throw new Error("parameter 'type' must be one of image|video|audio|document|sticker");
  }
  if (path === "/message/sendReceipt") {
    await sess.client.message.sendReceipt(reqStr(p, "jid"), reqList(p, "ids"), { type: str(p, "type") as never });
    return { sent: true };
  }
  /* The download routes take the `seq` of a buffered incoming message —
   * the number /messages and /events report — not a hand-written JSON
   * message. A media download needs the mediaKey, directPath and
   * fileEncSha256 the server sent, so the only message that can be
   * downloaded is one this process received; and zapo's parameter is a
   * union that an open JSON record cannot become. */
  if (path === "/message/downloadBytes") {
    const seq = reqNum(p, "seq");
    const src = messageBySeq(sess, seq);
    if (src === undefined) {
      throw new Error(`no buffered message with seq ${seq} (take 'seq' from GET /messages; the buffer holds the last ${EVENT_BUFFER} events)`);
    }
    const bytes = await sess.client.message.downloadBytes(src, { maxBytes: num(p, "maxBytes") });
    return { seq: seq, length: bytes.length, base64: Buffer.from(bytes).toString("base64") };
  }
  if (path === "/message/downloadToFile") {
    const seq = reqNum(p, "seq");
    const src = messageBySeq(sess, seq);
    if (src === undefined) {
      throw new Error(`no buffered message with seq ${seq} (take 'seq' from GET /messages; the buffer holds the last ${EVENT_BUFFER} events)`);
    }
    const filePath = reqStr(p, "filePath");
    await sess.client.message.downloadToFile(src, filePath, { maxBytes: num(p, "maxBytes") });
    return { seq: seq, written: filePath };
  }
  if (path === "/message/requestHistorySync") {
    const input = obj(p, "input");
    if (input === undefined) throw new Error("missing required parameter 'input'");
    return await sess.client.message.requestHistorySync(input as never);
  }
  if (path === "/message/getReachoutTimelock") return await sess.client.message.getReachoutTimelock();
  if (path === "/message/getNewChatMessageCapping") return await sess.client.message.getNewChatMessageCapping();
  if (path === "/message/syncSignalSession") {
    await sess.client.message.syncSignalSession(reqStr(p, "jid"), bool(p, "reasonIdentity"));
    return { synced: true };
  }

  /* ── presence ───────────────────────────────────────────────────────── */
  if (path === "/presence/send") {
    const t = str(p, "type");
    await sess.client.presence.send(t === "unavailable" ? "unavailable" : "available");
    return { sent: true };
  }
  if (path === "/presence/sendChatstate") {
    const state = reqStr(p, "state");
    if (state !== "composing" && state !== "paused") throw new Error("parameter 'state' must be composing|paused");
    const media = str(p, "media");
    if (media === "audio") {
      await sess.client.presence.sendChatstate(reqStr(p, "jid"), { state: "composing", media: "audio" });
    } else {
      await sess.client.presence.sendChatstate(reqStr(p, "jid"), { state: state });
    }
    return { sent: true };
  }
  if (path === "/presence/subscribe") {
    await sess.client.presence.subscribe(reqStr(p, "jid"));
    return { subscribed: true };
  }

  /* ── chat (app-state mutations) ─────────────────────────────────────── */
  if (path === "/chat/sync") return await sess.client.chat.sync();
  if (path === "/chat/setChatMute") {
    await sess.client.chat.setChatMute(reqStr(p, "chatJid"), reqBool(p, "muted"), num(p, "muteEndTimestampMs"));
    return { ok: true };
  }
  if (path === "/chat/setChatRead") {
    await sess.client.chat.setChatRead(reqStr(p, "chatJid"), reqBool(p, "read"));
    return { ok: true };
  }
  if (path === "/chat/setChatPin") {
    await sess.client.chat.setChatPin(reqStr(p, "chatJid"), reqBool(p, "pinned"));
    return { ok: true };
  }
  if (path === "/chat/setChatArchive") {
    await sess.client.chat.setChatArchive(reqStr(p, "chatJid"), reqBool(p, "archived"));
    return { ok: true };
  }
  if (path === "/chat/setChatLock") {
    await sess.client.chat.setChatLock(reqStr(p, "chatJid"), reqBool(p, "locked"));
    return { ok: true };
  }
  if (path === "/chat/clearChat") {
    await sess.client.chat.clearChat(reqStr(p, "chatJid"), { deleteStarred: bool(p, "deleteStarred"), deleteMedia: bool(p, "deleteMedia") });
    return { ok: true };
  }
  if (path === "/chat/deleteChat") {
    await sess.client.chat.deleteChat(reqStr(p, "chatJid"), { deleteMedia: bool(p, "deleteMedia") });
    return { ok: true };
  }
  if (path === "/chat/setMessageStar") {
    await sess.client.chat.setMessageStar(
      { chatJid: reqStr(p, "chatJid"), id: reqStr(p, "id"), fromMe: reqBool(p, "fromMe"), participantJid: str(p, "participantJid") },
      reqBool(p, "starred"),
    );
    return { ok: true };
  }
  if (path === "/chat/deleteMessageForMe") {
    await sess.client.chat.deleteMessageForMe(
      { chatJid: reqStr(p, "chatJid"), id: reqStr(p, "id"), fromMe: reqBool(p, "fromMe"), participantJid: str(p, "participantJid") },
      { deleteMedia: bool(p, "deleteMedia"), messageTimestampMs: num(p, "messageTimestampMs") },
    );
    return { ok: true };
  }
  if (path === "/chat/setUserStatusMute") {
    await sess.client.chat.setUserStatusMute(reqStr(p, "jid"), reqBool(p, "muted"));
    return { ok: true };
  }
  if (path === "/chat/removeBroadcastList") {
    await sess.client.chat.removeBroadcastList(reqStr(p, "id"));
    return { ok: true };
  }
  if (path === "/chat/flushMutations") {
    await sess.client.chat.flushMutations();
    return { ok: true };
  }

  /* ── group ──────────────────────────────────────────────────────────── */
  if (path === "/group/queryGroupMetadata") return await sess.client.group.queryGroupMetadata(reqStr(p, "groupJid"));
  if (path === "/group/queryAllGroups") return await sess.client.group.queryAllGroups();
  if (path === "/group/queryGroupInviteInfo") return await sess.client.group.queryGroupInviteInfo(reqStr(p, "code"));
  if (path === "/group/createGroup") return await sess.client.group.createGroup(reqStr(p, "subject"), reqList(p, "participants"));
  if (path === "/group/setSubject") {
    await sess.client.group.setSubject(reqStr(p, "groupJid"), reqStr(p, "subject"));
    return { ok: true };
  }
  if (path === "/group/setDescription") {
    const d = str(p, "description");
    await sess.client.group.setDescription(reqStr(p, "groupJid"), d !== undefined ? d : null, str(p, "prevDescId"));
    return { ok: true };
  }
  if (path === "/group/setSetting") {
    await sess.client.group.setSetting(reqStr(p, "groupJid"), reqStr(p, "setting") as never, reqBool(p, "enabled"));
    return { ok: true };
  }
  if (path === "/group/setMemberAddMode") {
    await sess.client.group.setMemberAddMode(reqStr(p, "groupJid"), reqStr(p, "mode") as never);
    return { ok: true };
  }
  if (path === "/group/setMemberLinkMode") {
    await sess.client.group.setMemberLinkMode(reqStr(p, "groupJid"), reqStr(p, "mode") as never);
    return { ok: true };
  }
  if (path === "/group/setMemberShareGroupHistoryMode") {
    await sess.client.group.setMemberShareGroupHistoryMode(reqStr(p, "groupJid"), reqStr(p, "mode") as never);
    return { ok: true };
  }
  if (path === "/group/setEphemeralDuration") {
    await sess.client.group.setEphemeralDuration(reqStr(p, "groupJid"), reqNum(p, "expirationSeconds"), num(p, "trigger"));
    return { ok: true };
  }
  if (path === "/group/addParticipants") return await sess.client.group.addParticipants(reqStr(p, "groupJid"), reqList(p, "participants"));
  if (path === "/group/removeParticipants") return await sess.client.group.removeParticipants(reqStr(p, "groupJid"), reqList(p, "participants"));
  if (path === "/group/promoteParticipants") return await sess.client.group.promoteParticipants(reqStr(p, "groupJid"), reqList(p, "participants"));
  if (path === "/group/demoteParticipants") return await sess.client.group.demoteParticipants(reqStr(p, "groupJid"), reqList(p, "participants"));
  if (path === "/group/leaveGroup") {
    await sess.client.group.leaveGroup(reqList(p, "groupJids"));
    return { ok: true };
  }
  if (path === "/group/queryInviteCode") return await sess.client.group.queryInviteCode(reqStr(p, "groupJid"));
  if (path === "/group/revokeInvite") return await sess.client.group.revokeInvite(reqStr(p, "groupJid"));
  if (path === "/group/joinGroupViaInvite") return await sess.client.group.joinGroupViaInvite(reqStr(p, "code"));
  if (path === "/group/createCommunity") return await sess.client.group.createCommunity(reqStr(p, "subject"));
  if (path === "/group/deactivateCommunity") {
    await sess.client.group.deactivateCommunity(reqStr(p, "communityJid"));
    return { ok: true };
  }
  if (path === "/group/linkSubGroups") return await sess.client.group.linkSubGroups(reqStr(p, "communityJid"), reqList(p, "subGroupJids"));
  if (path === "/group/unlinkSubGroups") return await sess.client.group.unlinkSubGroups(reqStr(p, "communityJid"), reqList(p, "subGroupJids"));
  if (path === "/group/queryLinkedGroupsParticipants") return await sess.client.group.queryLinkedGroupsParticipants(reqStr(p, "communityJid"));
  if (path === "/group/fetchSubGroups") return await sess.client.group.fetchSubGroups(reqStr(p, "communityJid"));
  if (path === "/group/queryMembershipApprovalRequests") return await sess.client.group.queryMembershipApprovalRequests(reqStr(p, "groupJid"));
  if (path === "/group/approveMembershipRequests") {
    await sess.client.group.approveMembershipRequests(reqStr(p, "groupJid"), reqList(p, "participantJids"));
    return { ok: true };
  }
  if (path === "/group/rejectMembershipRequests") {
    await sess.client.group.rejectMembershipRequests(reqStr(p, "groupJid"), reqList(p, "participantJids"));
    return { ok: true };
  }
  if (path === "/group/cancelMembershipRequests") {
    await sess.client.group.cancelMembershipRequests(reqStr(p, "groupJid"), reqList(p, "participantJids"));
    return { ok: true };
  }
  if (path === "/group/joinLinkedGroup") {
    await sess.client.group.joinLinkedGroup(reqStr(p, "communityJid"), reqStr(p, "subGroupJid"));
    return { ok: true };
  }
  if (path === "/group/isInternalGroup") return await sess.client.group.isInternalGroup(reqStr(p, "groupJid"));
  if (path === "/group/transferCommunityOwnership") {
    await sess.client.group.transferCommunityOwnership(reqStr(p, "communityJid"), reqStr(p, "newOwnerJid"));
    return { ok: true };
  }
  if (path === "/group/fetchSubgroupSuggestions") return await sess.client.group.fetchSubgroupSuggestions(reqStr(p, "communityJid"), reqStr(p, "hintSubgroupJid"));
  if (path === "/group/submitGroupSuspensionAppeal") return await sess.client.group.submitGroupSuspensionAppeal(reqStr(p, "groupJid"));

  /* ── privacy ────────────────────────────────────────────────────────── */
  if (path === "/privacy/getPrivacySettings") return await sess.client.privacy.getPrivacySettings();
  if (path === "/privacy/setPrivacySetting") {
    await sess.client.privacy.setPrivacySetting(reqStr(p, "setting") as never, reqStr(p, "value") as never);
    return { ok: true };
  }
  if (path === "/privacy/getDisallowedList") return await sess.client.privacy.getDisallowedList(reqStr(p, "category") as never);
  if (path === "/privacy/getBlocklist") return await sess.client.privacy.getBlocklist();
  if (path === "/privacy/blockUser") {
    await sess.client.privacy.blockUser(reqStr(p, "jid"));
    return { ok: true };
  }
  if (path === "/privacy/unblockUser") {
    await sess.client.privacy.unblockUser(reqStr(p, "jid"));
    return { ok: true };
  }

  /* ── profile ────────────────────────────────────────────────────────── */
  if (path === "/profile/getProfilePicture") return await sess.client.profile.getProfilePicture(reqStr(p, "jid"), str(p, "type") as never, str(p, "existingId"));
  if (path === "/profile/deleteProfilePicture") {
    await sess.client.profile.deleteProfilePicture(str(p, "targetJid"));
    return { ok: true };
  }
  if (path === "/profile/getStatus") return await sess.client.profile.getStatus(reqStr(p, "jid"));
  if (path === "/profile/setStatus") {
    await sess.client.profile.setStatus(reqStr(p, "text"));
    return { ok: true };
  }
  if (path === "/profile/setPushName") {
    await sess.client.profile.setPushName(reqStr(p, "name"));
    return { ok: true };
  }
  if (path === "/profile/getProfiles") return await sess.client.profile.getProfiles(reqList(p, "jids"));
  if (path === "/profile/getDisappearingMode") return await sess.client.profile.getDisappearingMode(reqList(p, "jids"));
  if (path === "/profile/setDisappearingMode") {
    await sess.client.profile.setDisappearingMode(reqNum(p, "durationSeconds"));
    return { ok: true };
  }
  if (path === "/profile/getTextStatuses") return await sess.client.profile.getTextStatuses(reqList(p, "jids"));
  if (path === "/profile/getUsernames") return await sess.client.profile.getUsernames(reqList(p, "jids"));
  if (path === "/profile/getOwnUsername") return await sess.client.profile.getOwnUsername();
  if (path === "/profile/deleteUsername") return await sess.client.profile.deleteUsername();
  if (path === "/profile/getAboutStatus") return await sess.client.profile.getAboutStatus(reqStr(p, "jid"));
  if (path === "/profile/checkUsernameAvailability") return await sess.client.profile.checkUsernameAvailability(reqStr(p, "username"));
  if (path === "/profile/setUsernameKey") return await sess.client.profile.setUsernameKey(reqStr(p, "pin"));
  if (path === "/profile/getLidsByPhoneNumbers") return await sess.client.profile.getLidsByPhoneNumbers(reqList(p, "phoneNumbers"));

  /* ── business ───────────────────────────────────────────────────────── */
  if (path === "/business/getBusinessProfile") return await sess.client.business.getBusinessProfile(reqList(p, "jids"));
  if (path === "/business/getVerifiedName") return await sess.client.business.getVerifiedName(reqStr(p, "jid"));
  if (path === "/business/getVerifiedNames") return await sess.client.business.getVerifiedNames(reqList(p, "jids"));
  if (path === "/business/deleteCoverPhoto") {
    await sess.client.business.deleteCoverPhoto(reqStr(p, "id"));
    return { ok: true };
  }

  /* ── bot ────────────────────────────────────────────────────────────── */
  if (path === "/bot/listBots") return await sess.client.bot.listBots();
  if (path === "/bot/getBotProfile") return await sess.client.bot.getBotProfile(reqStr(p, "jid"));
  if (path === "/bot/sendPrompt") return await sess.client.bot.sendPrompt(reqStr(p, "to"), { type: "text", text: reqStr(p, "text") });

  /* ── email ──────────────────────────────────────────────────────────── */
  if (path === "/email/getStatus") return await sess.client.email.getStatus();
  if (path === "/email/setEmail") return await sess.client.email.setEmail(reqStr(p, "email"));
  if (path === "/email/verifyCode") return await sess.client.email.verifyCode(reqStr(p, "code"));
  if (path === "/email/confirm") {
    await sess.client.email.confirm();
    return { ok: true };
  }

  /* ── mobile (companion management) ──────────────────────────────────── */
  if (path === "/mobile/listCompanions") return await sess.client.mobile.listCompanions();
  if (path === "/mobile/linkCompanion") return await sess.client.mobile.linkCompanion(reqStr(p, "qr"));
  if (path === "/mobile/linkCompanionByCode") return await sess.client.mobile.linkCompanionByCode(reqStr(p, "pairingCode"));
  if (path === "/mobile/revokeCompanion") {
    await sess.client.mobile.revokeCompanion(reqStr(p, "companionDeviceJid"), str(p, "reason"));
    return { ok: true };
  }
  if (path === "/mobile/revokeAllCompanions") {
    await sess.client.mobile.revokeAllCompanions(str(p, "reason"));
    return { ok: true };
  }
  if (path === "/mobile/reconcileCompanions") return await sess.client.mobile.reconcileCompanions();
  if (path === "/mobile/publishKeyIndexList") {
    await sess.client.mobile.publishKeyIndexList();
    return { ok: true };
  }
  if (path === "/mobile/shareAppStateSyncKeys") {
    await sess.client.mobile.shareAppStateSyncKeys(reqStr(p, "companionDeviceJid"));
    return { ok: true };
  }

  /* ── status (stories) ───────────────────────────────────────────────── */
  if (path === "/status/setUserMuted") {
    await sess.client.status.setUserMuted(reqStr(p, "jid"), reqBool(p, "muted"));
    return { ok: true };
  }

  /* ── broadcast lists ────────────────────────────────────────────────── */
  if (path === "/broadcastList/removeList") {
    await sess.client.broadcastList.removeList(reqStr(p, "id"));
    return { ok: true };
  }

  /* ── newsletter (channels) ──────────────────────────────────────────── */
  if (path === "/newsletter/follow") {
    await sess.client.newsletter.follow(reqStr(p, "newsletterJid"));
    return { ok: true };
  }
  if (path === "/newsletter/unfollow") {
    await sess.client.newsletter.unfollow(reqStr(p, "newsletterJid"));
    return { ok: true };
  }
  if (path === "/newsletter/delete") {
    await sess.client.newsletter.delete(reqStr(p, "newsletterJid"));
    return { ok: true };
  }
  if (path === "/newsletter/fetchAdminInfo") return await sess.client.newsletter.fetchAdminInfo(reqStr(p, "newsletterJid"));
  if (path === "/newsletter/fetchFollowers") return await sess.client.newsletter.fetchFollowers(reqStr(p, "newsletterJid"));
  if (path === "/newsletter/fetchPendingInvites") return await sess.client.newsletter.fetchPendingInvites(reqStr(p, "newsletterJid"));
  if (path === "/newsletter/fetchReports") return await sess.client.newsletter.fetchReports();
  if (path === "/newsletter/acceptAdminInvite") {
    await sess.client.newsletter.acceptAdminInvite(reqStr(p, "newsletterJid"));
    return { ok: true };
  }
  if (path === "/newsletter/subscribeLiveUpdates") return await sess.client.newsletter.subscribeLiveUpdates(reqStr(p, "newsletterJid"));
  if (path === "/newsletter/send") {
    return await sess.client.newsletter.send(reqStr(p, "newsletterJid"), { type: "text", text: reqStr(p, "text") });
  }
  if (path === "/newsletter/editMessage") {
    return await sess.client.newsletter.editMessage(reqStr(p, "newsletterJid"), reqStr(p, "parentMessageId"), { type: "text", text: reqStr(p, "text") });
  }
  if (path === "/newsletter/fetchIsDomainPreviewable") {
    const m = await sess.client.newsletter.fetchIsDomainPreviewable(reqList(p, "domains"));
    const outMap: Bag = {};
    m.forEach((v, k) => {
      outMap[k] = v;
    });
    return outMap;
  }

  /* ── lowlevel ───────────────────────────────────────────────────────── */
  if (path === "/lowlevel/query") {
    const node = obj(p, "node");
    if (node === undefined) throw new Error("missing required parameter 'node' (a JSON BinaryNode)");
    return await sess.client.lowlevel.query(node as never, num(p, "timeoutMs"));
  }
  if (path === "/lowlevel/sendNode") {
    const node = obj(p, "node");
    if (node === undefined) throw new Error("missing required parameter 'node' (a JSON BinaryNode)");
    await sess.client.lowlevel.sendNode(node as never);
    return { sent: true };
  }

  /* ── status (stories), record-argument routes ───────────────────────── */
  if (path === "/status/setPrivacy") {
    await sess.client.status.setPrivacy(inputOf(p) as never);
    return { ok: true };
  }
  if (path === "/status/send") return await sess.client.status.send(inputOf(p) as never);
  if (path === "/status/revokeStatus") return await sess.client.status.revokeStatus(inputOf(p) as never);

  /* ── broadcast lists, record-argument routes ────────────────────────── */
  if (path === "/broadcastList/setList") {
    await sess.client.broadcastList.setList(inputOf(p) as never);
    return { ok: true };
  }
  if (path === "/broadcastList/send") return await sess.client.broadcastList.send(inputOf(p) as never);
  if (path === "/chat/setBroadcastList") {
    await sess.client.chat.setBroadcastList(inputOf(p) as never);
    return { ok: true };
  }
  if (path === "/chat/setStatusPrivacy") {
    await sess.client.chat.setStatusPrivacy(inputOf(p) as never);
    return { ok: true };
  }

  /* ── profile / business / email, record-argument routes ─────────────── */
  if (path === "/profile/setTextStatus") {
    await sess.client.profile.setTextStatus(inputOf(p) as never);
    return { ok: true };
  }
  if (path === "/profile/setUsername") return await sess.client.profile.setUsername(inputOf(p) as never);
  if (path === "/business/editBusinessProfile") {
    await sess.client.business.editBusinessProfile(inputOf(p) as never);
    return { ok: true };
  }
  if (path === "/email/requestVerificationCode") {
    await sess.client.email.requestVerificationCode(inputOf(p) as never);
    return { ok: true };
  }

  /* ── newsletter (channels), the rest of the surface ─────────────────── */
  if (path === "/newsletter/fetch") return await sess.client.newsletter.fetch(reqStr(p, "newsletterJid"));
  if (path === "/newsletter/fetchByInvite") return await sess.client.newsletter.fetchByInvite(reqStr(p, "inviteCode"));
  if (path === "/newsletter/listSubscribed") return await sess.client.newsletter.listSubscribed();
  if (path === "/newsletter/searchDirectory") return await sess.client.newsletter.searchDirectory(inputOf(p) as never);
  if (path === "/newsletter/fetchRecommended") return await sess.client.newsletter.fetchRecommended(inputOf(p) as never);
  if (path === "/newsletter/fetchSimilar") return await sess.client.newsletter.fetchSimilar(reqStr(p, "newsletterJid"));
  if (path === "/newsletter/fetchDirectoryList") return await sess.client.newsletter.fetchDirectoryList(inputOf(p) as never);
  if (path === "/newsletter/fetchDirectoryCategoriesPreview") return await sess.client.newsletter.fetchDirectoryCategoriesPreview(inputOf(p) as never);
  if (path === "/newsletter/fetchDehydrated") return await sess.client.newsletter.fetchDehydrated(reqStr(p, "keyOrInvite"));
  if (path === "/newsletter/create") return await sess.client.newsletter.create(inputOf(p) as never);
  if (path === "/newsletter/update") return await sess.client.newsletter.update(reqStr(p, "newsletterJid"), inputOf(p) as never);
  if (path === "/newsletter/fetchAdminCapabilities") {
    const set = await sess.client.newsletter.fetchAdminCapabilities(reqStr(p, "newsletterJid"));
    const caps: string[] = [];
    set.forEach((v) => {
      caps.push(v);
    });
    return caps;
  }
  if (path === "/newsletter/fetchInsights") return await sess.client.newsletter.fetchInsights(reqStr(p, "newsletterJid"), []);
  if (path === "/newsletter/fetchEnforcements") return await sess.client.newsletter.fetchEnforcements(reqStr(p, "newsletterJid"));
  if (path === "/newsletter/fetchPollVoters") {
    const m = await sess.client.newsletter.fetchPollVoters({
      newsletterJid: reqStr(p, "newsletterJid"),
      messageServerId: reqNum(p, "messageServerId"),
      voteHash: reqStr(p, "voteHash"),
      limit: num(p, "limit"),
    });
    const outMap: Bag = {};
    m.forEach((v, k) => {
      outMap[k] = v;
    });
    return outMap;
  }
  if (path === "/newsletter/fetchMessageReactionSenders") {
    return await sess.client.newsletter.fetchMessageReactionSenders({
      newsletterJid: reqStr(p, "newsletterJid"),
      messageServerId: reqNum(p, "messageServerId"),
    });
  }
  if (path === "/newsletter/logExposures") {
    await sess.client.newsletter.logExposures([]);
    return { ok: true };
  }
  if (path === "/newsletter/changeOwner") {
    await sess.client.newsletter.changeOwner(inputOf(p) as never);
    return { ok: true };
  }
  if (path === "/newsletter/demoteAdmin") {
    await sess.client.newsletter.demoteAdmin(inputOf(p) as never);
    return { ok: true };
  }
  if (path === "/newsletter/createAdminInvite") return await sess.client.newsletter.createAdminInvite(inputOf(p) as never);
  if (path === "/newsletter/revokeAdminInvite") {
    await sess.client.newsletter.revokeAdminInvite(inputOf(p) as never);
    return { ok: true };
  }
  if (path === "/newsletter/queryTosState") return await sess.client.newsletter.queryTosState(reqList(p, "noticeIds"));
  if (path === "/newsletter/acceptTos") {
    await sess.client.newsletter.acceptTos(reqList(p, "noticeIds"));
    return { ok: true };
  }
  if (path === "/newsletter/react") return await sess.client.newsletter.react(inputOf(p) as never);
  if (path === "/newsletter/revoke") return await sess.client.newsletter.revoke(inputOf(p) as never);
  if (path === "/newsletter/votePoll") return await sess.client.newsletter.votePoll(inputOf(p) as never);
  if (path === "/newsletter/sendViewReceipt") return await sess.client.newsletter.sendViewReceipt(inputOf(p) as never);
  if (path === "/newsletter/fetchMessages") {
    return await sess.client.newsletter.fetchMessages({
      newsletterJid: reqStr(p, "newsletterJid"),
      count: num(p, "count") !== undefined ? reqNum(p, "count") : 50,
      before: num(p, "before"),
      after: num(p, "after"),
    });
  }
  if (path === "/newsletter/fetchMessageUpdates") {
    return await sess.client.newsletter.fetchMessageUpdates({
      newsletterJid: reqStr(p, "newsletterJid"),
      count: num(p, "count") !== undefined ? reqNum(p, "count") : 50,
      since: num(p, "since"),
      before: num(p, "before"),
      after: num(p, "after"),
    });
  }
  if (path === "/newsletter/mute") {
    await sess.client.newsletter.mute(inputOf(p) as never);
    return { ok: true };
  }

  return undefined;
}


/* ── dispatch ──────────────────────────────────────────────────────────── */

/* ROUTE SPELLING. Every zapo route is addressed to exactly one session:
 *
 *     /s/<sessionId>/<route>          e.g. /s/alice/message/sendText
 *     /<route>                        the SAME route on ZAPO_SESSION
 *
 * The service-level registry lives under /sessions and is never prefixed.
 * An unknown session is a clean 404; a malformed id is a 400. Neither can
 * reach a handler, so no zapo call ever runs without a session behind it. */
const SESSION_PREFIX = "/s/";

function finish(pending: Promise<unknown>, res: ServerResponse, shown: string): void {
  pending.then(
    (result) => {
      if (result === undefined) {
        send(res, 404, {
          error: "not_found",
          path: shown,
          hint: "routes are addressed as /s/<sessionId>/<route>, or unprefixed for the default session; GET /sessions lists the sessions",
        });
        return;
      }
      send(res, 200, { ok: true, result: result });
    },
    (err: unknown) => {
      fail(res, err);
    },
  );
}

const server = createServer((req: IncomingMessage, res: ServerResponse) => {
  const raw = req.url !== undefined ? req.url : "/";
  const qIdx = raw.indexOf("?");
  const path = qIdx === -1 ? raw : raw.slice(0, qIdx);
  const query = qIdx === -1 ? "" : raw.slice(qIdx + 1);
  const method = req.method !== undefined ? req.method : "GET";

  if (TOKEN !== "") {
    const given = req.headers["x-api-key"];
    if (given !== TOKEN) {
      send(res, 401, { error: "unauthorized", detail: "set the x-api-key header to ZAPO_REST_TOKEN" });
      return;
    }
  }

  let body = "";
  req.on("data", (chunk: Buffer) => {
    body += chunk.toString("utf8");
  });
  req.on("end", () => {
    const p: Bag = {};
    parseQuery(query, p);
    if (body !== "") {
      try {
        const parsed = JSON.parse(body) as unknown;
        if (typeof parsed === "object" && parsed !== null) {
          const bag = parsed as Bag;
          for (const k of Object.keys(bag)) p[k] = bag[k];
        }
      } catch (err: unknown) {
        send(res, 400, { error: "bad_json", detail: String(err) });
        return;
      }
    }

    try {
      if (path === "/sessions" || path.indexOf("/sessions/") === 0) {
        finish(registryRoute(method, path, p), res, path);
        return;
      }

      let id = DEFAULT_SESSION;
      let sub = path;
      if (path.indexOf(SESSION_PREFIX) === 0) {
        const rest = path.slice(SESSION_PREFIX.length);
        const slash = rest.indexOf("/");
        id = slash === -1 ? rest : rest.slice(0, slash);
        sub = slash === -1 ? "/" : rest.slice(slash);
      }
      if (!idOk(id)) {
        send(res, 400, {
          error: "bad_session_id",
          sessionId: id,
          detail: `invalid session id '${id}'; expected ${ID_SPELLING}`,
        });
        return;
      }
      const sess = findSession(id);
      if (sess === undefined) {
        send(res, 404, {
          error: "no_such_session",
          sessionId: id,
          detail: `no such session '${id}'`,
          hint: "GET /sessions lists them; POST /sessions/create?id=<id> starts one",
        });
        return;
      }
      finish(route(method, sub, p, sess), res, path);
    } catch (err: unknown) {
      fail(res, err);
    }
  });
});

/* The push endpoint. 'upgrade' fires INSTEAD of 'request' for a
 * Connection: upgrade request and hands the socket over raw, which is the
 * whole seam a WebSocket server needs -- see the endpoint's own note. */
server.on("upgrade", (req: IncomingMessage, socket: Socket, head: Buffer) => {
  wsAttach(req, socket, head);
});

/* The store is LAZY: createMysqlPool does not connect, createMysqlStore and
 * createStore do not touch the server, and the 21 migrations only run when a
 * domain first reads (BaseMysqlStore.ensureReady -> ensureMysqlMigrations).
 * Reaching the server here forces that up front, so a first run creates and
 * MIGRATES the schema before any request arrives -- and so the set of
 * sessions can be read back out of the database rather than guessed.
 *
 * It also reads the SERVER's cache facts, exactly once, for /health and
 * /sessions/shrink to report. See /health for why not per request. */
function initStore(): void {
  /* The first round trip IS the readiness check: a pool that cannot reach
   * the server fails here rather than on the first request. */
  pool.execute("SELECT 1 AS n", []).then(
    async () => {
      conn = pool;
      try {
        await ensureRegistryTable(pool);
      } catch (err: unknown) {
        storeError = String(err);
        conn = null;
        console.log(`  store    : FAILED to create the session registry: ${String(err)}`);
        return;
      }
      try {
        const row = await sqlGet(
          pool,
          "SELECT @@innodb_buffer_pool_size AS bufferPoolBytes, @@innodb_buffer_pool_instances AS bufferPoolInstances, " +
            "@@max_prepared_stmt_count AS maxPreparedStmtCount, @@version AS version, @@max_connections AS maxConnections",
          [],
        );
        if (row !== null) {
          const bytes = countOf(row, "bufferPoolBytes");
          serverFacts = {
            version: typeof row["version"] === "string" ? row["version"] : null,
            innodbBufferPoolBytes: bytes,
            innodbBufferPoolMiB: bytes === 0 ? 0 : Math.round((bytes / 1048576) * 100) / 100,
            innodbBufferPoolInstances: countOf(row, "bufferPoolInstances"),
            maxPreparedStmtCount: countOf(row, "maxPreparedStmtCount"),
            maxConnections: countOf(row, "maxConnections"),
            note: "SERVER properties, shared with every other client of this instance. This process neither sets nor bounds them.",
          };
        }
      } catch (err: unknown) {
        /* Not fatal and not hidden: a server that will not report its own
         * variables still serves the store. */
        serverFacts = { error: String(err) };
      }
      storeReady = true;

      const ids = await knownIds(pool);
      /* autoconnect is per-session and persisted; a session with no registry
       * row (data only) inherits the service default. */
      const auto: Bag = {};
      for (const r of await sqlAll(pool, "SELECT session_id, autoconnect FROM `zapo_rest_sessions`", [])) {
        const sid = r["session_id"];
        if (typeof sid === "string") auto[sid] = countOf(r, "autoconnect") !== 0;
      }

      /* Always keep the default session alive, so an unprefixed request has
       * somewhere to land even on a brand-new database. */
      let hasDefault = false;
      for (const id of ids) {
        if (id === DEFAULT_SESSION) hasDefault = true;
      }
      if (!hasDefault) {
        ids.push(DEFAULT_SESSION);
        await registryUpsert(DEFAULT_SESSION, true, "the default session");
      }

      console.log(`  store    : ready; ${ids.length} session(s) known in ${DB_DSN}`);
      for (const id of ids) {
        if (!idOk(id)) {
          console.log(`  session ${id}: SKIPPED, the id is not ${ID_SPELLING}`);
          continue;
        }
        const sess = makeSession(id);
        const a = auto[id];
        initSession(sess, AUTOCONNECT && a !== false);
      }
    },
    (err: unknown) => {
      storeError = String(err);
      console.log(`  store    : FAILED to reach ${DB_DSN}: ${String(err)}`);
    },
  );
}

server.listen(PORT, HOST, () => {
  console.log(`zapo-rest listening on http://${HOST}:${PORT}`);
  console.log(`  store    : mysql ${DB_DSN} (one pool of ${POOL_SIZE}, N sessions)`);
  if (IGNORED_DB_PATH !== "") {
    console.log(`             ZAPO_DB=${IGNORED_DB_PATH} is IGNORED: this build has no sqlite file`);
  }
  console.log(`  cleanup  : ${CLEANUP_ON ? "a poller per session (MySQL cache domains need one; SQLite does not)" : "OFF (ZAPO_MYSQL_CLEANUP=0) -- cache tables will grow monotonically"}`);
  console.log(`  default  : ${DEFAULT_SESSION}   (an unprefixed /<route> is addressed to it)`);
  console.log(`  sessions : /s/<sessionId>/<route>; GET /sessions lists them`);
  console.log(`  push     : ws://${HOST}:${PORT}/s/<sessionId>${WS_ROUTE} — the /events stream, pushed`);
  console.log(`             window ${WS_WINDOW} unacked events, closed with 1013 after ${WS_LAG_MS}ms at the window`);
  console.log(`  auth     : ${TOKEN === "" ? "OPEN (set ZAPO_REST_TOKEN to require x-api-key)" : "x-api-key required"}`);
  if (AUTOCONNECT) {
    console.log("  connecting every session with autoconnect set; QRs will print below as they arrive");
  } else {
    console.log("  ZAPO_AUTOCONNECT=0 — POST /s/<id>/connect to start one");
  }
  initStore();
});
