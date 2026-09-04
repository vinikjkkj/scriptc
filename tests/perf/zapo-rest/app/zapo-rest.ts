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
import { createSqliteStore, openSqliteConnection } from "@zapo-js/store-sqlite";

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
const SESSION_ID = envStr("ZAPO_SESSION", "default");
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

/* ── the event ring ────────────────────────────────────────────────────── */

interface Ev {
  readonly seq: number;
  readonly at: number;
  readonly type: string;
  readonly data: unknown;
}

const events: Ev[] = [];
let seqCounter = 0;

function push(type: string, data: unknown): void {
  seqCounter += 1;
  events.push({ seq: seqCounter, at: Date.now(), type: type, data: data });
  if (events.length > EVENT_BUFFER) events.shift();
}

function since(kindPrefix: string, from: number, limit: number): Ev[] {
  const out: Ev[] = [];
  for (const e of events) {
    if (e.seq <= from) continue;
    if (kindPrefix !== "" && e.type !== kindPrefix) continue;
    out.push(e);
    if (out.length >= limit) break;
  }
  return out;
}

/* ── connection / QR state ─────────────────────────────────────────────── */

let currentQr: string | null = null;
let currentQrTtlMs = 0;
let currentQrAt = 0;
let pairingCode: string | null = null;
let connected = false;
let lastConnectionEvent: unknown = null;
let connectStarted = false;
let sentCount = 0;
let recvCount = 0;

/* ── the store and the client ──────────────────────────────────────────── */

const backend = createSqliteStore({ path: DB_PATH, driver: "auto" });
const store = createStore({
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

const client = new WaClient({
  store: store,
  sessionId: SESSION_ID,
  connectTimeoutMs: envNum("ZAPO_CONNECT_TIMEOUT_MS", 30000),
  deviceBrowser: envStr("ZAPO_DEVICE_BROWSER", "Chrome"),
  deviceOsDisplayName: envStr("ZAPO_DEVICE_OS", "Windows"),
  /* ZAPO_WS_URL points the client at a non-default endpoint. Used to drive the
   * binary against a local fake server for verification; leave unset for real
   * WhatsApp. */
  chatSocketUrls: envStr("ZAPO_WS_URL", "") !== "" ? [envStr("ZAPO_WS_URL", "")] : undefined,
});

client.on("auth_qr", (e) => {
  currentQr = e.qr;
  currentQrTtlMs = e.ttlMs;
  currentQrAt = Date.now();
  push("auth_qr", { qr: e.qr, ttlMs: e.ttlMs });
  console.log(`[qr] ttlMs=${e.ttlMs}`);
  console.log(`[qr] ${e.qr}`);
});
client.on("auth_pairing_code", (e) => {
  pairingCode = e.code;
  push("auth_pairing_code", { code: e.code });
  console.log(`[pairing-code] ${e.code}`);
});
client.on("auth_pairing_required", (e) => {
  push("auth_pairing_required", { forceManual: e.forceManual });
});
client.on("auth_paired", () => {
  currentQr = null;
  push("auth_paired", { paired: true });
  console.log("[auth] paired");
});
client.on("connection", (e) => {
  connected = e.status === "open";
  lastConnectionEvent = e;
  if (connected) currentQr = null;
  push("connection", e);
  console.log(`[connection] ${e.status} reason=${String(e.reason)}`);
});
client.on("message", (e) => {
  recvCount += 1;
  push("message", e);
});
client.on("message_send", (e) => {
  sentCount += 1;
  push("message_send", e);
});
client.on("receipt", (e) => {
  push("receipt", e);
});
client.on("presence", (e) => {
  push("presence", e);
});
client.on("chatstate", (e) => {
  push("chatstate", e);
});
client.on("call", (e) => {
  push("call", e);
});
client.on("group", (e) => {
  push("group", e);
});
client.on("newsletter", (e) => {
  push("newsletter", e);
});
client.on("stream_failure", (e) => {
  push("stream_failure", e);
});

function startConnect(): void {
  if (connectStarted) return;
  connectStarted = true;
  client.connect().then(
    () => {
      console.log("[connect] resolved");
    },
    (err: unknown) => {
      connectStarted = false;
      push("connect_error", { error: String(err) });
      console.log(`[connect] failed: ${String(err)}`);
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
  send(res, 500, { error: "error", detail: text });
}

const sessionStore = store.session(SESSION_ID);

/* Route table. Each entry answers a value (or a promise of one) which is
 * serialized as {"ok":true,"result":...}. */
async function route(method: string, path: string, p: Bag): Promise<unknown> {
  /* ── service ────────────────────────────────────────────────────────── */
  if (path === "/health") {
    return {
      ok: true,
      uptimeMs: Date.now() - STARTED_MS,
      store: { driver: "sqlite", path: DB_PATH, sessionId: SESSION_ID },
      connection: {
        connected: connected,
        hasQr: currentQr !== null,
        last: lastConnectionEvent,
      },
      state: client.getState(),
      counts: { sent: sentCount, received: recvCount, events: events.length, seq: seqCounter },
    };
  }
  if (path === "/state") return client.getState();
  if (path === "/qr") {
    return {
      qr: currentQr,
      ttlMs: currentQrTtlMs,
      issuedAt: currentQrAt,
      ageMs: currentQrAt === 0 ? null : Date.now() - currentQrAt,
      pairingCode: pairingCode,
    };
  }
  if (path === "/events") {
    return since(str(p, "type") !== undefined ? reqStr(p, "type") : "", num(p, "since") !== undefined ? reqNum(p, "since") : 0, num(p, "limit") !== undefined ? reqNum(p, "limit") : 100);
  }
  if (path === "/messages") {
    return since("message", num(p, "since") !== undefined ? reqNum(p, "since") : 0, num(p, "limit") !== undefined ? reqNum(p, "limit") : 100);
  }
  if (path === "/connect") {
    startConnect();
    return { starting: true, note: "connect() stays pending until pairing completes on a fresh session; poll /qr and /health" };
  }
  if (path === "/disconnect") {
    await client.disconnect();
    connectStarted = false;
    return { disconnected: true };
  }
  if (path === "/logout") {
    await client.logout();
    return { loggedOut: true };
  }
  if (path === "/credentials") {
    const c = client.getCredentials();
    if (c === null) return null;
    /* Never serialize the credential record: it holds private keys. */
    return { present: true, redacted: true, note: "credential material is deliberately not exposed over HTTP" };
  }
  if (path === "/clockSkewMs") return client.getClockSkewMs();

  /* ── store reads ────────────────────────────────────────────────────── */
  if (path === "/store/threads") {
    return await sessionStore.threads.list(num(p, "limit") !== undefined ? reqNum(p, "limit") : 100);
  }
  if (path === "/store/thread") {
    return await sessionStore.threads.getByJid(reqStr(p, "jid"));
  }
  if (path === "/store/messages") {
    return await sessionStore.messages.listByThread(
      reqStr(p, "thread"),
      num(p, "limit") !== undefined ? reqNum(p, "limit") : 50,
      num(p, "before"),
    );
  }
  if (path === "/store/message") {
    return await sessionStore.messages.getById(reqStr(p, "id"));
  }
  if (path === "/store/contact") {
    const byPhone = str(p, "phone");
    if (byPhone !== undefined) return await sessionStore.contacts.getByPhoneNumber(byPhone);
    return await sessionStore.contacts.getByJid(reqStr(p, "jid"));
  }
  if (path === "/store/contacts") {
    /* WaContactStore exposes no list(); read the table directly. */
    const conn = await openSqliteConnection({ path: DB_PATH, sessionId: SESSION_ID });
    try {
      const limit = num(p, "limit") !== undefined ? reqNum(p, "limit") : 200;
      return conn.all(
        "SELECT jid, display_name, push_name, lid, phone_number, last_updated_ms FROM mailbox_contacts WHERE session_id = ? ORDER BY last_updated_ms DESC LIMIT ?",
        [SESSION_ID, limit],
      );
    } finally {
      conn.close();
    }
  }
  if (path === "/store/tables") {
    const conn = await openSqliteConnection({ path: DB_PATH, sessionId: SESSION_ID });
    try {
      return conn.all("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name", []);
    } finally {
      conn.close();
    }
  }
  if (path === "/store/counts") {
    const conn = await openSqliteConnection({ path: DB_PATH, sessionId: SESSION_ID });
    try {
      const names = conn.all<{ name: string }>(
        "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name",
        [],
      );
      const counts: Bag = {};
      for (const row of names) {
        const t = row.name;
        const one = conn.get<{ n: number }>(`SELECT COUNT(*) AS n FROM "${t}"`, []);
        counts[t] = one === null ? 0 : one.n;
      }
      return counts;
    } finally {
      conn.close();
    }
  }

  /* ── auth ───────────────────────────────────────────────────────────── */
  if (path === "/auth/getState") return client.auth.getState(connected);
  if (path === "/auth/loadOrCreateCredentials") {
    await client.auth.loadOrCreateCredentials();
    return { loaded: true, redacted: true };
  }
  if (path === "/auth/requestPairingCode") {
    return await client.auth.requestPairingCode(
      reqStr(p, "phoneNumber"),
      bool(p, "shouldShowPushNotification"),
      str(p, "customCode"),
    );
  }
  if (path === "/auth/fetchPairingCountryCodeIso") return await client.auth.fetchPairingCountryCodeIso();
  if (path === "/auth/clearTransientState") {
    await client.auth.clearTransientState();
    return { cleared: true };
  }
  if (path === "/auth/clearStoredCredentials") {
    await client.auth.clearStoredCredentials();
    return { cleared: true };
  }
  if (path === "/auth/setNextConnectVersion") {
    client.auth.setNextConnectVersion(reqStr(p, "version"));
    return { set: true };
  }
  if (path === "/auth/setNextConnectMobileAppVersion") {
    client.auth.setNextConnectMobileAppVersion(reqStr(p, "appVersion"));
    return { set: true };
  }

  /* ── message ────────────────────────────────────────────────────────── */
  if (path === "/message/send") {
    const to = reqStr(p, "to");
    const text = str(p, "text");
    const content = obj(p, "content");
    const options = obj(p, "options");
    if (text !== undefined) {
      if (options !== undefined) return await client.message.send(to, { type: "text", text: text }, options);
      return await client.message.send(to, { type: "text", text: text });
    }
    if (content === undefined) throw new Error("missing required parameter 'text' or 'content'");
    if (options !== undefined) return await client.message.send(to, content, options);
    return await client.message.send(to, content);
  }
  if (path === "/message/sendText") {
    return await client.message.send(reqStr(p, "to"), { type: "text", text: reqStr(p, "text") });
  }
  if (path === "/message/reply") {
    return await client.message.send(
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
    return await client.message.send(reqStr(p, "to"), {
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
    return await client.message.send(reqStr(p, "to"), {
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
    return await client.message.send(reqStr(p, "to"), {
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
    return await client.message.send(reqStr(p, "to"), {
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
      return await client.message.send(to, { type: "image", media: mediaPath, mimetype: str(p, "mimetype"), caption: str(p, "caption") });
    }
    if (kind === "video") {
      return await client.message.send(to, { type: "video", media: mediaPath, mimetype: str(p, "mimetype"), caption: str(p, "caption") });
    }
    if (kind === "audio") {
      return await client.message.send(to, { type: "audio", media: mediaPath, mimetype: str(p, "mimetype"), ptt: bool(p, "ptt") });
    }
    if (kind === "document") {
      return await client.message.send(to, { type: "document", media: mediaPath, mimetype: str(p, "mimetype"), fileName: str(p, "fileName") });
    }
    if (kind === "sticker") {
      return await client.message.send(to, { type: "sticker", media: mediaPath, mimetype: str(p, "mimetype") });
    }
    throw new Error("parameter 'type' must be one of image|video|audio|document|sticker");
  }
  if (path === "/message/sendReceipt") {
    await client.message.sendReceipt(reqStr(p, "jid"), reqList(p, "ids"), { type: str(p, "type") as never });
    return { sent: true };
  }
  if (path === "/message/downloadBytes") {
    const src = obj(p, "message");
    if (src === undefined) throw new Error("missing required parameter 'message' (a JSON message object)");
    const bytes = await client.message.downloadBytes(src, { maxBytes: num(p, "maxBytes") });
    return { length: bytes.length, base64: Buffer.from(bytes).toString("base64") };
  }
  if (path === "/message/downloadToFile") {
    const src = obj(p, "message");
    if (src === undefined) throw new Error("missing required parameter 'message'");
    await client.message.downloadToFile(src, reqStr(p, "filePath"), { maxBytes: num(p, "maxBytes") });
    return { written: reqStr(p, "filePath") };
  }
  if (path === "/message/requestHistorySync") {
    const input = obj(p, "input");
    if (input === undefined) throw new Error("missing required parameter 'input'");
    return await client.message.requestHistorySync(input as never);
  }
  if (path === "/message/getReachoutTimelock") return await client.message.getReachoutTimelock();
  if (path === "/message/getNewChatMessageCapping") return await client.message.getNewChatMessageCapping();
  if (path === "/message/syncSignalSession") {
    await client.message.syncSignalSession(reqStr(p, "jid"), bool(p, "reasonIdentity"));
    return { synced: true };
  }

  /* ── presence ───────────────────────────────────────────────────────── */
  if (path === "/presence/send") {
    const t = str(p, "type");
    await client.presence.send(t === "unavailable" ? "unavailable" : "available");
    return { sent: true };
  }
  if (path === "/presence/sendChatstate") {
    const state = reqStr(p, "state");
    if (state !== "composing" && state !== "paused") throw new Error("parameter 'state' must be composing|paused");
    const media = str(p, "media");
    if (media === "audio") {
      await client.presence.sendChatstate(reqStr(p, "jid"), { state: "composing", media: "audio" });
    } else {
      await client.presence.sendChatstate(reqStr(p, "jid"), { state: state });
    }
    return { sent: true };
  }
  if (path === "/presence/subscribe") {
    await client.presence.subscribe(reqStr(p, "jid"));
    return { subscribed: true };
  }

  /* ── chat (app-state mutations) ─────────────────────────────────────── */
  if (path === "/chat/sync") return await client.chat.sync();
  if (path === "/chat/setChatMute") {
    await client.chat.setChatMute(reqStr(p, "chatJid"), reqBool(p, "muted"), num(p, "muteEndTimestampMs"));
    return { ok: true };
  }
  if (path === "/chat/setChatRead") {
    await client.chat.setChatRead(reqStr(p, "chatJid"), reqBool(p, "read"));
    return { ok: true };
  }
  if (path === "/chat/setChatPin") {
    await client.chat.setChatPin(reqStr(p, "chatJid"), reqBool(p, "pinned"));
    return { ok: true };
  }
  if (path === "/chat/setChatArchive") {
    await client.chat.setChatArchive(reqStr(p, "chatJid"), reqBool(p, "archived"));
    return { ok: true };
  }
  if (path === "/chat/setChatLock") {
    await client.chat.setChatLock(reqStr(p, "chatJid"), reqBool(p, "locked"));
    return { ok: true };
  }
  if (path === "/chat/clearChat") {
    await client.chat.clearChat(reqStr(p, "chatJid"), { deleteStarred: bool(p, "deleteStarred"), deleteMedia: bool(p, "deleteMedia") });
    return { ok: true };
  }
  if (path === "/chat/deleteChat") {
    await client.chat.deleteChat(reqStr(p, "chatJid"), { deleteMedia: bool(p, "deleteMedia") });
    return { ok: true };
  }
  if (path === "/chat/setMessageStar") {
    await client.chat.setMessageStar(
      { chatJid: reqStr(p, "chatJid"), id: reqStr(p, "id"), fromMe: reqBool(p, "fromMe"), participantJid: str(p, "participantJid") },
      reqBool(p, "starred"),
    );
    return { ok: true };
  }
  if (path === "/chat/deleteMessageForMe") {
    await client.chat.deleteMessageForMe(
      { chatJid: reqStr(p, "chatJid"), id: reqStr(p, "id"), fromMe: reqBool(p, "fromMe"), participantJid: str(p, "participantJid") },
      { deleteMedia: bool(p, "deleteMedia"), messageTimestampMs: num(p, "messageTimestampMs") },
    );
    return { ok: true };
  }
  if (path === "/chat/setUserStatusMute") {
    await client.chat.setUserStatusMute(reqStr(p, "jid"), reqBool(p, "muted"));
    return { ok: true };
  }
  if (path === "/chat/removeBroadcastList") {
    await client.chat.removeBroadcastList(reqStr(p, "id"));
    return { ok: true };
  }
  if (path === "/chat/flushMutations") {
    await client.chat.flushMutations();
    return { ok: true };
  }

  /* ── group ──────────────────────────────────────────────────────────── */
  if (path === "/group/queryGroupMetadata") return await client.group.queryGroupMetadata(reqStr(p, "groupJid"));
  if (path === "/group/queryAllGroups") return await client.group.queryAllGroups();
  if (path === "/group/queryGroupInviteInfo") return await client.group.queryGroupInviteInfo(reqStr(p, "code"));
  if (path === "/group/createGroup") return await client.group.createGroup(reqStr(p, "subject"), reqList(p, "participants"));
  if (path === "/group/setSubject") {
    await client.group.setSubject(reqStr(p, "groupJid"), reqStr(p, "subject"));
    return { ok: true };
  }
  if (path === "/group/setDescription") {
    const d = str(p, "description");
    await client.group.setDescription(reqStr(p, "groupJid"), d !== undefined ? d : null, str(p, "prevDescId"));
    return { ok: true };
  }
  if (path === "/group/setSetting") {
    await client.group.setSetting(reqStr(p, "groupJid"), reqStr(p, "setting") as never, reqBool(p, "enabled"));
    return { ok: true };
  }
  if (path === "/group/setMemberAddMode") {
    await client.group.setMemberAddMode(reqStr(p, "groupJid"), reqStr(p, "mode") as never);
    return { ok: true };
  }
  if (path === "/group/setMemberLinkMode") {
    await client.group.setMemberLinkMode(reqStr(p, "groupJid"), reqStr(p, "mode") as never);
    return { ok: true };
  }
  if (path === "/group/setMemberShareGroupHistoryMode") {
    await client.group.setMemberShareGroupHistoryMode(reqStr(p, "groupJid"), reqStr(p, "mode") as never);
    return { ok: true };
  }
  if (path === "/group/setEphemeralDuration") {
    await client.group.setEphemeralDuration(reqStr(p, "groupJid"), reqNum(p, "expirationSeconds"), num(p, "trigger"));
    return { ok: true };
  }
  if (path === "/group/addParticipants") return await client.group.addParticipants(reqStr(p, "groupJid"), reqList(p, "participants"));
  if (path === "/group/removeParticipants") return await client.group.removeParticipants(reqStr(p, "groupJid"), reqList(p, "participants"));
  if (path === "/group/promoteParticipants") return await client.group.promoteParticipants(reqStr(p, "groupJid"), reqList(p, "participants"));
  if (path === "/group/demoteParticipants") return await client.group.demoteParticipants(reqStr(p, "groupJid"), reqList(p, "participants"));
  if (path === "/group/leaveGroup") {
    await client.group.leaveGroup(reqList(p, "groupJids"));
    return { ok: true };
  }
  if (path === "/group/queryInviteCode") return await client.group.queryInviteCode(reqStr(p, "groupJid"));
  if (path === "/group/revokeInvite") return await client.group.revokeInvite(reqStr(p, "groupJid"));
  if (path === "/group/joinGroupViaInvite") return await client.group.joinGroupViaInvite(reqStr(p, "code"));
  if (path === "/group/createCommunity") return await client.group.createCommunity(reqStr(p, "subject"));
  if (path === "/group/deactivateCommunity") {
    await client.group.deactivateCommunity(reqStr(p, "communityJid"));
    return { ok: true };
  }
  if (path === "/group/linkSubGroups") return await client.group.linkSubGroups(reqStr(p, "communityJid"), reqList(p, "subGroupJids"));
  if (path === "/group/unlinkSubGroups") return await client.group.unlinkSubGroups(reqStr(p, "communityJid"), reqList(p, "subGroupJids"));
  if (path === "/group/queryLinkedGroupsParticipants") return await client.group.queryLinkedGroupsParticipants(reqStr(p, "communityJid"));
  if (path === "/group/fetchSubGroups") return await client.group.fetchSubGroups(reqStr(p, "communityJid"));
  if (path === "/group/queryMembershipApprovalRequests") return await client.group.queryMembershipApprovalRequests(reqStr(p, "groupJid"));
  if (path === "/group/approveMembershipRequests") {
    await client.group.approveMembershipRequests(reqStr(p, "groupJid"), reqList(p, "participantJids"));
    return { ok: true };
  }
  if (path === "/group/rejectMembershipRequests") {
    await client.group.rejectMembershipRequests(reqStr(p, "groupJid"), reqList(p, "participantJids"));
    return { ok: true };
  }
  if (path === "/group/cancelMembershipRequests") {
    await client.group.cancelMembershipRequests(reqStr(p, "groupJid"), reqList(p, "participantJids"));
    return { ok: true };
  }
  if (path === "/group/joinLinkedGroup") {
    await client.group.joinLinkedGroup(reqStr(p, "communityJid"), reqStr(p, "subGroupJid"));
    return { ok: true };
  }
  if (path === "/group/isInternalGroup") return await client.group.isInternalGroup(reqStr(p, "groupJid"));
  if (path === "/group/transferCommunityOwnership") {
    await client.group.transferCommunityOwnership(reqStr(p, "communityJid"), reqStr(p, "newOwnerJid"));
    return { ok: true };
  }
  if (path === "/group/fetchSubgroupSuggestions") return await client.group.fetchSubgroupSuggestions(reqStr(p, "communityJid"), reqStr(p, "hintSubgroupJid"));
  if (path === "/group/submitGroupSuspensionAppeal") return await client.group.submitGroupSuspensionAppeal(reqStr(p, "groupJid"));

  /* ── privacy ────────────────────────────────────────────────────────── */
  if (path === "/privacy/getPrivacySettings") return await client.privacy.getPrivacySettings();
  if (path === "/privacy/setPrivacySetting") {
    await client.privacy.setPrivacySetting(reqStr(p, "setting") as never, reqStr(p, "value") as never);
    return { ok: true };
  }
  if (path === "/privacy/getDisallowedList") return await client.privacy.getDisallowedList(reqStr(p, "category") as never);
  if (path === "/privacy/getBlocklist") return await client.privacy.getBlocklist();
  if (path === "/privacy/blockUser") {
    await client.privacy.blockUser(reqStr(p, "jid"));
    return { ok: true };
  }
  if (path === "/privacy/unblockUser") {
    await client.privacy.unblockUser(reqStr(p, "jid"));
    return { ok: true };
  }

  /* ── profile ────────────────────────────────────────────────────────── */
  if (path === "/profile/getProfilePicture") return await client.profile.getProfilePicture(reqStr(p, "jid"), str(p, "type") as never, str(p, "existingId"));
  if (path === "/profile/deleteProfilePicture") {
    await client.profile.deleteProfilePicture(str(p, "targetJid"));
    return { ok: true };
  }
  if (path === "/profile/getStatus") return await client.profile.getStatus(reqStr(p, "jid"));
  if (path === "/profile/setStatus") {
    await client.profile.setStatus(reqStr(p, "text"));
    return { ok: true };
  }
  if (path === "/profile/setPushName") {
    await client.profile.setPushName(reqStr(p, "name"));
    return { ok: true };
  }
  if (path === "/profile/getProfiles") return await client.profile.getProfiles(reqList(p, "jids"));
  if (path === "/profile/getDisappearingMode") return await client.profile.getDisappearingMode(reqList(p, "jids"));
  if (path === "/profile/setDisappearingMode") {
    await client.profile.setDisappearingMode(reqNum(p, "durationSeconds"));
    return { ok: true };
  }
  if (path === "/profile/getTextStatuses") return await client.profile.getTextStatuses(reqList(p, "jids"));
  if (path === "/profile/getUsernames") return await client.profile.getUsernames(reqList(p, "jids"));
  if (path === "/profile/getOwnUsername") return await client.profile.getOwnUsername();
  if (path === "/profile/deleteUsername") return await client.profile.deleteUsername();
  if (path === "/profile/getAboutStatus") return await client.profile.getAboutStatus(reqStr(p, "jid"));
  if (path === "/profile/checkUsernameAvailability") return await client.profile.checkUsernameAvailability(reqStr(p, "username"));
  if (path === "/profile/setUsernameKey") return await client.profile.setUsernameKey(reqStr(p, "pin"));
  if (path === "/profile/getLidsByPhoneNumbers") return await client.profile.getLidsByPhoneNumbers(reqList(p, "phoneNumbers"));

  /* ── business ───────────────────────────────────────────────────────── */
  if (path === "/business/getBusinessProfile") return await client.business.getBusinessProfile(reqList(p, "jids"));
  if (path === "/business/getVerifiedName") return await client.business.getVerifiedName(reqStr(p, "jid"));
  if (path === "/business/getVerifiedNames") return await client.business.getVerifiedNames(reqList(p, "jids"));
  if (path === "/business/deleteCoverPhoto") {
    await client.business.deleteCoverPhoto(reqStr(p, "id"));
    return { ok: true };
  }

  /* ── bot ────────────────────────────────────────────────────────────── */
  if (path === "/bot/listBots") return await client.bot.listBots();
  if (path === "/bot/getBotProfile") return await client.bot.getBotProfile(reqStr(p, "jid"));
  if (path === "/bot/sendPrompt") return await client.bot.sendPrompt(reqStr(p, "to"), { type: "text", text: reqStr(p, "text") });

  /* ── email ──────────────────────────────────────────────────────────── */
  if (path === "/email/getStatus") return await client.email.getStatus();
  if (path === "/email/setEmail") return await client.email.setEmail(reqStr(p, "email"));
  if (path === "/email/verifyCode") return await client.email.verifyCode(reqStr(p, "code"));
  if (path === "/email/confirm") {
    await client.email.confirm();
    return { ok: true };
  }

  /* ── mobile (companion management) ──────────────────────────────────── */
  if (path === "/mobile/listCompanions") return await client.mobile.listCompanions();
  if (path === "/mobile/linkCompanion") return await client.mobile.linkCompanion(reqStr(p, "qr"));
  if (path === "/mobile/linkCompanionByCode") return await client.mobile.linkCompanionByCode(reqStr(p, "pairingCode"));
  if (path === "/mobile/revokeCompanion") {
    await client.mobile.revokeCompanion(reqStr(p, "companionDeviceJid"), str(p, "reason"));
    return { ok: true };
  }
  if (path === "/mobile/revokeAllCompanions") {
    await client.mobile.revokeAllCompanions(str(p, "reason"));
    return { ok: true };
  }
  if (path === "/mobile/reconcileCompanions") return await client.mobile.reconcileCompanions();
  if (path === "/mobile/publishKeyIndexList") {
    await client.mobile.publishKeyIndexList();
    return { ok: true };
  }
  if (path === "/mobile/shareAppStateSyncKeys") {
    await client.mobile.shareAppStateSyncKeys(reqStr(p, "companionDeviceJid"));
    return { ok: true };
  }

  /* ── status (stories) ───────────────────────────────────────────────── */
  if (path === "/status/setUserMuted") {
    await client.status.setUserMuted(reqStr(p, "jid"), reqBool(p, "muted"));
    return { ok: true };
  }

  /* ── broadcast lists ────────────────────────────────────────────────── */
  if (path === "/broadcastList/removeList") {
    await client.broadcastList.removeList(reqStr(p, "id"));
    return { ok: true };
  }

  /* ── newsletter (channels) ──────────────────────────────────────────── */
  if (path === "/newsletter/follow") {
    await client.newsletter.follow(reqStr(p, "newsletterJid"));
    return { ok: true };
  }
  if (path === "/newsletter/unfollow") {
    await client.newsletter.unfollow(reqStr(p, "newsletterJid"));
    return { ok: true };
  }
  if (path === "/newsletter/delete") {
    await client.newsletter.delete(reqStr(p, "newsletterJid"));
    return { ok: true };
  }
  if (path === "/newsletter/fetchAdminInfo") return await client.newsletter.fetchAdminInfo(reqStr(p, "newsletterJid"));
  if (path === "/newsletter/fetchFollowers") return await client.newsletter.fetchFollowers(reqStr(p, "newsletterJid"));
  if (path === "/newsletter/fetchPendingInvites") return await client.newsletter.fetchPendingInvites(reqStr(p, "newsletterJid"));
  if (path === "/newsletter/fetchReports") return await client.newsletter.fetchReports();
  if (path === "/newsletter/acceptAdminInvite") {
    await client.newsletter.acceptAdminInvite(reqStr(p, "newsletterJid"));
    return { ok: true };
  }
  if (path === "/newsletter/subscribeLiveUpdates") return await client.newsletter.subscribeLiveUpdates(reqStr(p, "newsletterJid"));
  if (path === "/newsletter/send") {
    return await client.newsletter.send(reqStr(p, "newsletterJid"), { type: "text", text: reqStr(p, "text") });
  }
  if (path === "/newsletter/editMessage") {
    return await client.newsletter.editMessage(reqStr(p, "newsletterJid"), reqStr(p, "parentMessageId"), { type: "text", text: reqStr(p, "text") });
  }
  if (path === "/newsletter/fetchIsDomainPreviewable") {
    const m = await client.newsletter.fetchIsDomainPreviewable(reqList(p, "domains"));
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
    return await client.lowlevel.query(node as never, num(p, "timeoutMs"));
  }
  if (path === "/lowlevel/sendNode") {
    const node = obj(p, "node");
    if (node === undefined) throw new Error("missing required parameter 'node' (a JSON BinaryNode)");
    await client.lowlevel.sendNode(node as never);
    return { sent: true };
  }

  /* ── status (stories), record-argument routes ───────────────────────── */
  if (path === "/status/setPrivacy") {
    await client.status.setPrivacy(inputOf(p) as never);
    return { ok: true };
  }
  if (path === "/status/send") return await client.status.send(inputOf(p) as never);
  if (path === "/status/revokeStatus") return await client.status.revokeStatus(inputOf(p) as never);

  /* ── broadcast lists, record-argument routes ────────────────────────── */
  if (path === "/broadcastList/setList") {
    await client.broadcastList.setList(inputOf(p) as never);
    return { ok: true };
  }
  if (path === "/broadcastList/send") return await client.broadcastList.send(inputOf(p) as never);
  if (path === "/chat/setBroadcastList") {
    await client.chat.setBroadcastList(inputOf(p) as never);
    return { ok: true };
  }
  if (path === "/chat/setStatusPrivacy") {
    await client.chat.setStatusPrivacy(inputOf(p) as never);
    return { ok: true };
  }

  /* ── profile / business / email, record-argument routes ─────────────── */
  if (path === "/profile/setTextStatus") {
    await client.profile.setTextStatus(inputOf(p) as never);
    return { ok: true };
  }
  if (path === "/profile/setUsername") return await client.profile.setUsername(inputOf(p) as never);
  if (path === "/business/editBusinessProfile") {
    await client.business.editBusinessProfile(inputOf(p) as never);
    return { ok: true };
  }
  if (path === "/email/requestVerificationCode") {
    await client.email.requestVerificationCode(inputOf(p) as never);
    return { ok: true };
  }

  /* ── newsletter (channels), the rest of the surface ─────────────────── */
  if (path === "/newsletter/fetch") return await client.newsletter.fetch(reqStr(p, "newsletterJid"));
  if (path === "/newsletter/fetchByInvite") return await client.newsletter.fetchByInvite(reqStr(p, "inviteCode"));
  if (path === "/newsletter/listSubscribed") return await client.newsletter.listSubscribed();
  if (path === "/newsletter/searchDirectory") return await client.newsletter.searchDirectory(inputOf(p) as never);
  if (path === "/newsletter/fetchRecommended") return await client.newsletter.fetchRecommended(inputOf(p) as never);
  if (path === "/newsletter/fetchSimilar") return await client.newsletter.fetchSimilar(reqStr(p, "newsletterJid"));
  if (path === "/newsletter/fetchDirectoryList") return await client.newsletter.fetchDirectoryList(inputOf(p) as never);
  if (path === "/newsletter/fetchDirectoryCategoriesPreview") return await client.newsletter.fetchDirectoryCategoriesPreview(inputOf(p) as never);
  if (path === "/newsletter/fetchDehydrated") return await client.newsletter.fetchDehydrated(reqStr(p, "keyOrInvite"));
  if (path === "/newsletter/create") return await client.newsletter.create(inputOf(p) as never);
  if (path === "/newsletter/update") return await client.newsletter.update(reqStr(p, "newsletterJid"), inputOf(p) as never);
  if (path === "/newsletter/fetchAdminCapabilities") {
    const set = await client.newsletter.fetchAdminCapabilities(reqStr(p, "newsletterJid"));
    const caps: string[] = [];
    set.forEach((v) => {
      caps.push(v);
    });
    return caps;
  }
  if (path === "/newsletter/fetchInsights") return await client.newsletter.fetchInsights(reqStr(p, "newsletterJid"), []);
  if (path === "/newsletter/fetchEnforcements") return await client.newsletter.fetchEnforcements(reqStr(p, "newsletterJid"));
  if (path === "/newsletter/fetchPollVoters") {
    const m = await client.newsletter.fetchPollVoters({
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
    return await client.newsletter.fetchMessageReactionSenders({
      newsletterJid: reqStr(p, "newsletterJid"),
      messageServerId: reqNum(p, "messageServerId"),
    });
  }
  if (path === "/newsletter/logExposures") {
    await client.newsletter.logExposures([]);
    return { ok: true };
  }
  if (path === "/newsletter/changeOwner") {
    await client.newsletter.changeOwner(inputOf(p) as never);
    return { ok: true };
  }
  if (path === "/newsletter/demoteAdmin") {
    await client.newsletter.demoteAdmin(inputOf(p) as never);
    return { ok: true };
  }
  if (path === "/newsletter/createAdminInvite") return await client.newsletter.createAdminInvite(inputOf(p) as never);
  if (path === "/newsletter/revokeAdminInvite") {
    await client.newsletter.revokeAdminInvite(inputOf(p) as never);
    return { ok: true };
  }
  if (path === "/newsletter/queryTosState") return await client.newsletter.queryTosState(reqList(p, "noticeIds"));
  if (path === "/newsletter/acceptTos") {
    await client.newsletter.acceptTos(reqList(p, "noticeIds"));
    return { ok: true };
  }
  if (path === "/newsletter/react") return await client.newsletter.react(inputOf(p) as never);
  if (path === "/newsletter/revoke") return await client.newsletter.revoke(inputOf(p) as never);
  if (path === "/newsletter/votePoll") return await client.newsletter.votePoll(inputOf(p) as never);
  if (path === "/newsletter/sendViewReceipt") return await client.newsletter.sendViewReceipt(inputOf(p) as never);
  if (path === "/newsletter/fetchMessages") {
    return await client.newsletter.fetchMessages({
      newsletterJid: reqStr(p, "newsletterJid"),
      count: num(p, "count") !== undefined ? reqNum(p, "count") : 50,
      before: num(p, "before"),
      after: num(p, "after"),
    });
  }
  if (path === "/newsletter/fetchMessageUpdates") {
    return await client.newsletter.fetchMessageUpdates({
      newsletterJid: reqStr(p, "newsletterJid"),
      count: num(p, "count") !== undefined ? reqNum(p, "count") : 50,
      since: num(p, "since"),
      before: num(p, "before"),
      after: num(p, "after"),
    });
  }
  if (path === "/newsletter/mute") {
    await client.newsletter.mute(inputOf(p) as never);
    return { ok: true };
  }

  return undefined;
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
      route(method, path, p).then(
        (result) => {
          if (result === undefined) {
            send(res, 404, { error: "not_found", path: path, hint: "GET /routes lists every route this build serves" });
            return;
          }
          send(res, 200, { ok: true, result: result });
        },
        (err: unknown) => {
          fail(res, err);
        },
      );
    } catch (err: unknown) {
      fail(res, err);
    }
  });
});

server.listen(PORT, HOST, () => {
  console.log(`zapo-rest listening on http://${HOST}:${PORT}`);
  console.log(`  store    : sqlite ${DB_PATH}`);
  console.log(`  session  : ${SESSION_ID}`);
  console.log(`  auth     : ${TOKEN === "" ? "OPEN (set ZAPO_REST_TOKEN to require x-api-key)" : "x-api-key required"}`);
  if (AUTOCONNECT) {
    console.log("  connecting to WhatsApp; the QR will print below when it arrives");
    startConnect();
  } else {
    console.log("  ZAPO_AUTOCONNECT=0 — POST /connect to start");
  }
});
