/* zapo-rest — a single compiled executable that runs a real WhatsApp client
 * against a persistent SQLite store and exposes zapo's public surface as a
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
/* zapo-js MUST be imported before @zapo-js/store-sqlite: the two provenance
 * checkouts collide on ~39 tsconfig "paths" alias keys, the paths table is one
 * per program, and the FIRST package seen wins. With store-sqlite first, zapo-js's
 * own @client/@store aliases are lost and its barrel fails to resolve. */
import { WaClient, createStore } from "zapo-js";
import type { WaIncomingMessageEvent, WaStoreSession } from "zapo-js";
import { createSqliteStore, openSqliteConnection } from "@zapo-js/store-sqlite";
import type { WaSqliteConnection } from "@zapo-js/store-sqlite";

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
const DB_PATH = envStr("ZAPO_DB", "zapo-state.sqlite");
/* The session an UNPREFIXED route is addressed to. Every route also
 * answers at /s/<sessionId>/<route> for any session in the registry. */
const DEFAULT_SESSION = envStr("ZAPO_SESSION", "default");
const EVENT_BUFFER = envNum("ZAPO_EVENT_BUFFER", 1000);
const AUTOCONNECT = envStr("ZAPO_AUTOCONNECT", "1") !== "0";

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

/* ── the store: ONE file, ONE connection, N sessions ───────────────────── */

/* zapo's store-sqlite defaults are journal_mode=WAL, synchronous=normal and
 * busy_timeout=5000 -- it does NOT default cache_size, so the database would
 * run on SQLite's compiled-in 2 MiB page cache, which is small for a
 * long-lived server with a real message archive. cache_size IS on
 * store-sqlite's allowed-pragma list, so this is a supported knob and not a
 * patch: a negative value is KiB. ZAPO_SQLITE_CACHE_KB=0 leaves zapo's
 * behaviour exactly as shipped. */
const CACHE_KB = envNum("ZAPO_SQLITE_CACHE_KB", 16000);

/* ONE backend for every session. `createSqliteStore` builds its per-domain
 * options as `(sessionId, domain) => WaSqliteStorageOptions`
 * (createSqliteStore.ts:172) -- the sessionId is a PARAMETER of the store
 * factory, not of the bundle -- so a single backend already serves N
 * sessions, and each domain store carries its own session id into every
 * statement.
 *
 * ONE CONNECTION. `openSqliteConnection` keys its process-wide connection
 * cache on `driver|path|pragmas|tableNames` (connection.ts:437) -- the
 * sessionId is NOT in that key -- and `BaseSqliteStore.getConnection()`
 * (BaseSqliteStore.ts:41) is the only way a domain store reaches SQLite.
 * So every domain of every session lands on the SAME cache entry and the
 * SAME better-sqlite3 Database; the per-store `close()` is a refcount
 * decrement on a shared handle, not a file close. The service's own raw
 * queries below therefore open with the SAME driver/pragmas/tableNames, so
 * they join that entry instead of opening a second connection. (The
 * single-session predecessor did NOT: it opened its raw handle with no
 * pragmas while the stores passed cache_size, which is a different cache
 * key -- two connections to one file. GET /sessions/connection proves the
 * current arrangement empirically, with a negative control.) */
const backend =
  CACHE_KB > 0
    ? createSqliteStore({ path: DB_PATH, driver: "auto", pragmas: { cache_size: -CACHE_KB } })
    : createSqliteStore({ path: DB_PATH, driver: "auto" });
const rootStore = createStore({
  backends: { sqlite: backend },
  providers: {
    auth: "sqlite",
    signal: "sqlite",
    preKey: "sqlite",
    session: "sqlite",
    identity: "sqlite",
    senderKey: "sqlite",
    appState: "sqlite",
    privacyToken: "sqlite",
    messages: "sqlite",
    threads: "sqlite",
    contacts: "sqlite",
  },
});

/** A handle on the shared connection, opened with the stores' EXACT options
 * so it lands on their cache entry. `sessionId` is required by the options
 * type but is not part of the cache key and is not used for any statement
 * issued through this handle -- every such statement names its session_id
 * explicitly. */
function openShared(): Promise<WaSqliteConnection> {
  if (CACHE_KB > 0) {
    return openSqliteConnection({
      sessionId: DEFAULT_SESSION,
      path: DB_PATH,
      driver: "auto",
      pragmas: { cache_size: -CACHE_KB },
    });
  }
  return openSqliteConnection({ sessionId: DEFAULT_SESSION, path: DB_PATH, driver: "auto" });
}

/** NEGATIVE CONTROL for /sessions/connection: the same file, the same
 * driver, a DIFFERENT pragma set -- so a different cache key, and therefore
 * a genuinely separate SQLite connection. Opened and closed inside that one
 * route; nothing else uses it. */
function openControl(): Promise<WaSqliteConnection> {
  const kb = CACHE_KB > 0 ? CACHE_KB : 2000;
  return openSqliteConnection({
    sessionId: DEFAULT_SESSION,
    path: DB_PATH,
    driver: "auto",
    pragmas: { cache_size: -(kb + 1) },
  });
}

let conn: WaSqliteConnection | null = null;
let storeReady = false;
let storeError: string | null = null;

function db(): WaSqliteConnection {
  if (conn === null) {
    throw new Error("the sqlite connection is not open yet; poll GET /sessions until ready is true");
  }
  return conn;
}

/* The 21 domain tables store-sqlite creates, every one of which carries
 * session_id (and has it in its PRIMARY KEY). `wa_migrations` -- the 22nd --
 * is the only table in the schema that does not, because it is per-FILE.
 * Listed here rather than discovered through pragma_table_info(), so the
 * per-session counts do not depend on an introspection pragma being
 * compiled into the vendored SQLite this binary links. */
const SESSION_TABLES: string[] = [
  "appstate_collection_index_values",
  "appstate_collection_versions",
  "appstate_sync_keys",
  "auth_credentials",
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

function tableExists(c: WaSqliteConnection, name: string): boolean {
  const row = c.get<{ n: number }>(
    "SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table' AND name = ?",
    [name],
  );
  return row !== null && row.n > 0;
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
  sess.events.push({ seq: sess.seq, at: Date.now(), type: type, data: data });
  if (sess.events.length > EVENT_BUFFER) sess.events.shift();
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

/* The service's OWN table, in the same file, so the set of sessions survives
 * a restart even before any of them has written a credential row. It is not
 * part of zapo's schema and zapo never reads it; store-sqlite's migration
 * runner only creates and versions its own 22 tables. */
function ensureRegistryTable(c: WaSqliteConnection): void {
  c.exec(
    "CREATE TABLE IF NOT EXISTS zapo_rest_sessions (" +
      "session_id TEXT PRIMARY KEY," +
      "created_ms INTEGER NOT NULL," +
      "autoconnect INTEGER NOT NULL DEFAULT 1," +
      "label TEXT)",
  );
}

/* SELECT-then-INSERT/UPDATE rather than `ON CONFLICT ... DO UPDATE`: the
 * upsert clause needs SQLite 3.24, and the SQLite this binary links is the
 * vendored copy the compiler intercepts, not the host's. Two statements on a
 * synchronous driver, so there is no window between them. */
function registryUpsert(id: string, autoconnect: boolean, label: string | undefined): void {
  const c = db();
  const lbl = label === undefined ? null : label;
  const existing = c.get<{ n: number }>(
    "SELECT COUNT(*) AS n FROM zapo_rest_sessions WHERE session_id = ?",
    [id],
  );
  if (existing !== null && existing.n > 0) {
    c.run("UPDATE zapo_rest_sessions SET autoconnect = ?, label = ? WHERE session_id = ?", [
      autoconnect ? 1 : 0,
      lbl,
      id,
    ]);
    return;
  }
  c.run(
    "INSERT INTO zapo_rest_sessions (session_id, created_ms, autoconnect, label) VALUES (?, ?, ?, ?)",
    [id, Date.now(), autoconnect ? 1 : 0, lbl],
  );
}

function registryDelete(id: string): void {
  db().run("DELETE FROM zapo_rest_sessions WHERE session_id = ?", [id]);
}

interface RegistryRow extends Record<string, unknown> {
  readonly session_id: unknown;
  readonly created_ms: unknown;
  readonly autoconnect: unknown;
  readonly label: unknown;
}

/** Row counts for ONE session, straight off the shared connection: one
 * `COUNT(*) ... WHERE session_id = ?` per domain table. This is the
 * instrument the isolation probe reads. */
function rowsFor(id: string): Bag {
  const c = db();
  const out: Bag = {};
  for (const t of SESSION_TABLES) {
    if (!tableExists(c, t)) continue;
    const one = c.get<{ n: number }>(`SELECT COUNT(*) AS n FROM "${t}" WHERE session_id = ?`, [id]);
    out[t] = one === null ? 0 : one.n;
  }
  return out;
}

/** The whole set of session ids the FILE knows about, regardless of whether
 * the service has a client for them: the registry table, plus every distinct
 * session_id in any domain table. A session that was created by an older
 * build, or whose registry row was removed while its data stayed, still
 * shows up here. */
function addId(out: string[], v: unknown): void {
  if (typeof v !== "string") return;
  if (v === "") return;
  for (const seen of out) {
    if (seen === v) return;
  }
  out.push(v);
}

function knownIds(c: WaSqliteConnection): string[] {
  const out: string[] = [];
  if (tableExists(c, "zapo_rest_sessions")) {
    for (const r of c.all<RegistryRow>("SELECT session_id FROM zapo_rest_sessions ORDER BY created_ms", [])) {
      addId(out, r.session_id);
    }
  }
  for (const t of SESSION_TABLES) {
    if (!tableExists(c, t)) continue;
    for (const r of c.all<{ session_id: unknown }>(`SELECT DISTINCT session_id FROM "${t}"`, [])) {
      addId(out, r.session_id);
    }
  }
  return out;
}

/** Deletes every row this session owns, in ONE transaction, and reports the
 * per-table counts it removed. Only reachable from
 * `POST /sessions/remove?purge=1`. */
async function purgeRows(id: string): Promise<Bag> {
  const c = db();
  const before = rowsFor(id);
  await c.runInTransaction(() => {
    for (const t of SESSION_TABLES) {
      if (!tableExists(c, t)) continue;
      c.run(`DELETE FROM "${t}" WHERE session_id = ?`, [id]);
    }
    return 0;
  });
  const after = rowsFor(id);
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
   * fresh bundle. With a SHARED connection the per-domain `destroy()` is a
   * refcount decrement on a handle, never a close of the file --
   * BaseSqliteStore.destroy() at BaseSqliteStore.ts:71. Another live session
   * therefore keeps working across this call. */
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
 * the schema on a fresh file) and, if asked, start connecting. */
function initSession(sess: Session, autoconnect: boolean): void {
  sess.store.auth.load().then(
    (creds) => {
      sess.ready = true;
      sess.hasCredentials = creds !== null;
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
      if (withRows) row["rows"] = rowsFor(s.id);
      out.push(row);
      live.push(s.id);
    }
    /* Sessions the FILE knows about but this process has no client for:
     * removed with their rows kept, or written by an older run. */
    if (conn !== null) {
      for (const id of knownIds(conn)) {
        let isLive = false;
        for (const l of live) {
          if (l === id) isLive = true;
        }
        if (isLive) continue;
        const row: Bag = { id: id, live: false, note: "rows exist in the database; no client is running for it" };
        if (withRows) row["rows"] = rowsFor(id);
        out.push(row);
      }
    }
    return {
      dbPath: DB_PATH,
      defaultSession: DEFAULT_SESSION,
      addressing: "/s/<sessionId>/<route>; an unprefixed /<route> is addressed to the default session",
      idSpelling: ID_SPELLING,
      ready: storeReady,
      storeError: storeError,
      connection: {
        file: DB_PATH,
        shared: true,
        note: "one better-sqlite3 connection serves every session; GET /sessions/connection proves it",
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
      registryUpsert(id, autoconnect, label);
      return { created: false, existing: true, session: summarize(existing) };
    }
    const sess = makeSession(id);
    registryUpsert(id, autoconnect, label);
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
      for (const k of knownIds(conn)) {
        if (k === id) onFile = true;
      }
    }
    if (sess === undefined && !onFile) throw new Error(`no such session '${id}'`);
    /* DELETION IS NOT THE DEFAULT. Without purge=1 this stops the client and
     * drops the registry row, and every one of the session's rows stays in
     * the file -- so re-creating the same id resumes the same paired
     * WhatsApp account. purge=1 additionally DELETEs the session's rows from
     * all 21 domain tables, which is irreversible and un-pairs it. */
    const purge = bool(p, "purge") === true;
    if (sess !== undefined) await stopSession(sess);
    if (conn !== null) registryDelete(id);
    if (!purge) {
      return {
        removed: true,
        id: id,
        stoppedClient: sess !== undefined,
        registryRowDeleted: conn !== null,
        rowsDeleted: false,
        rowsKept: conn === null ? null : rowsFor(id),
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
      note: "purge=1 was given: every row this session owned was DELETEd from all 21 domain tables",
    };
  }

  if (path === "/sessions/rows") {
    const id = reqStr(p, "id");
    if (!idOk(id)) throw new Error(`invalid session id '${id}'; expected ${ID_SPELLING}`);
    return { id: id, rows: rowsFor(id) };
  }

  if (path === "/sessions/connection") {
    /* ARMED PROOF that one connection serves every session.
     *
     * A SQLite TEMP table lives in the connection's own temp schema and is
     * invisible to any other connection to the same file. So: write a token
     * into a TEMP table through the service's handle, then read it back
     * through a handle opened with the STORES' EXACT options -- if that is
     * the same underlying better-sqlite3 Database, the token is there.
     *
     * The negative control is the discriminator: a handle opened on the same
     * file with a DIFFERENT pragma set gets a different cache key and hence
     * a genuinely separate connection, and it must NOT see the token. If
     * both see it the probe is measuring nothing. */
    const c = db();
    c.exec("CREATE TEMP TABLE IF NOT EXISTS zapo_rest_connprobe (n INTEGER)");
    c.run("DELETE FROM zapo_rest_connprobe", []);
    const token = Date.now();
    c.run("INSERT INTO zapo_rest_connprobe (n) VALUES (?)", [token]);

    const same = await openShared();
    let sameSees = false;
    let sameErr: string | null = null;
    try {
      const r = same.get<{ n: number }>("SELECT n FROM zapo_rest_connprobe", []);
      sameSees = r !== null && r.n === token;
    } catch (err: unknown) {
      sameErr = String(err);
    }
    same.close();

    const other = await openControl();
    let otherSees = false;
    let otherErr: string | null = null;
    try {
      const r = other.get<{ n: number }>("SELECT n FROM zapo_rest_connprobe", []);
      otherSees = r !== null && r.n === token;
    } catch (err: unknown) {
      otherErr = String(err);
    }
    other.close();

    return {
      probe: "a SQLite TEMP table is private to one connection",
      token: token,
      driver: c.driver,
      storeOptionsHandle: { seesTheTempRow: sameSees, error: sameErr },
      differentPragmaControl: { seesTheTempRow: otherSees, error: otherErr },
      verdict:
        sameSees && !otherSees
          ? "ONE connection: every session's stores share this exact SQLite connection"
          : sameSees && otherSees
            ? "INCONCLUSIVE: the control also saw the row, so the probe does not discriminate"
            : "NOT SHARED: a handle opened with the stores' own options is a different connection",
      cite: "openSqliteConnection keys its cache on driver|path|pragmas|tableNames (connection.ts:437); sessionId is not in the key",
    };
  }

  return undefined;
}

/* Route table. Each entry answers a value (or a promise of one) which is
 * serialized as {"ok":true,"result":...}. */
async function route(method: string, path: string, p: Bag, sess: Session): Promise<unknown> {
  /* ── service ────────────────────────────────────────────────────────── */
  if (path === "/health") {
    return {
      ok: true,
      uptimeMs: Date.now() - STARTED_MS,
      store: {
        driver: "sqlite",
        path: DB_PATH,
        sessionId: sess.id,
        /* ONE connection for the whole process, shared by every session. */
        sharedConnection: true,
        sessionsLive: sessions.length,
        cacheKiB: CACHE_KB > 0 ? CACHE_KB : "sqlite default",
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
     * SHARED connection -- and qualified by THIS session's id, which is what
     * keeps a raw read from crossing sessions the way a store read cannot. */
    const limit = num(p, "limit") !== undefined ? reqNum(p, "limit") : 200;
    return db().all(
      "SELECT jid, display_name, push_name, lid, phone_number, last_updated_ms FROM mailbox_contacts WHERE session_id = ? ORDER BY last_updated_ms DESC LIMIT ?",
      [sess.id, limit],
    );
  }
  if (path === "/store/tables") {
    return db().all("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name", []);
  }
  if (path === "/store/counts") {
    /* Two numbers per table: `total` is the whole file, `session` is the
     * rows THIS session owns. On a one-session file they are equal; the
     * moment they diverge, the gap is another session's rows -- which is
     * exactly what the isolation probe reads. `wa_migrations` is per-file
     * and has no session_id, so its `session` is reported as null rather
     * than as a zero that would look like a leak. */
    const c = db();
    const names = c.all<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name",
      [],
    );
    const counts: Bag = {};
    for (const row of names) {
      const t = row.name;
      const total = c.get<{ n: number }>(`SELECT COUNT(*) AS n FROM "${t}"`, []);
      if (!isSessionTable(t)) {
        counts[t] = { total: total === null ? 0 : total.n, session: null };
        continue;
      }
      const mine = c.get<{ n: number }>(`SELECT COUNT(*) AS n FROM "${t}" WHERE session_id = ?`, [sess.id]);
      counts[t] = { total: total === null ? 0 : total.n, session: mine === null ? 0 : mine.n };
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

/* The store is LAZY: createSqliteStore/createStore do not touch the file, and
 * the schema is only created when a domain first reads. Opening the shared
 * connection here forces that up front, so a first run creates and MIGRATES
 * the database before any request arrives -- and so the set of sessions can
 * be read back out of the file rather than guessed. */
function initStore(): void {
  openShared().then(
    (c) => {
      conn = c;
      try {
        ensureRegistryTable(c);
      } catch (err: unknown) {
        storeError = String(err);
        console.log(`  store    : FAILED to create the session registry: ${String(err)}`);
        return;
      }
      storeReady = true;

      const ids = knownIds(c);
      /* autoconnect is per-session and persisted; a session with no registry
       * row (data only) inherits the service default. */
      const auto: Bag = {};
      for (const r of c.all<RegistryRow>("SELECT session_id, autoconnect FROM zapo_rest_sessions", [])) {
        if (typeof r.session_id === "string") auto[r.session_id] = r.autoconnect !== 0;
      }

      /* Always keep the default session alive, so an unprefixed request has
       * somewhere to land even on a brand-new file. */
      let hasDefault = false;
      for (const id of ids) {
        if (id === DEFAULT_SESSION) hasDefault = true;
      }
      if (!hasDefault) {
        ids.push(DEFAULT_SESSION);
        registryUpsert(DEFAULT_SESSION, true, "the default session");
      }

      console.log(`  store    : ready; ${ids.length} session(s) known in ${DB_PATH}`);
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
      console.log(`  store    : FAILED to open: ${String(err)}`);
    },
  );
}

server.listen(PORT, HOST, () => {
  console.log(`zapo-rest listening on http://${HOST}:${PORT}`);
  console.log(`  store    : sqlite ${DB_PATH} (one file, one connection, N sessions)`);
  console.log(`  default  : ${DEFAULT_SESSION}   (an unprefixed /<route> is addressed to it)`);
  console.log(`  sessions : /s/<sessionId>/<route>; GET /sessions lists them`);
  console.log(`  auth     : ${TOKEN === "" ? "OPEN (set ZAPO_REST_TOKEN to require x-api-key)" : "x-api-key required"}`);
  if (AUTOCONNECT) {
    console.log("  connecting every session with autoconnect set; QRs will print below as they arrive");
  } else {
    console.log("  ZAPO_AUTOCONNECT=0 — POST /s/<id>/connect to start one");
  }
  initStore();
});
