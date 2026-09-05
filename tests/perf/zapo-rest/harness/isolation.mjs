// The cross-session isolation instrument.
//
// It talks to the SQLite file DIRECTLY, with its own better-sqlite3
// connection, and never through the service's HTTP API — because the API is
// the thing under test, and an API that shares a missing session_id
// qualifier would confirm its own bug.
//
// ARMING. Every mode aborts rather than report a reassuring nothing:
//   * `plant` verifies afterwards that the rows it claims to have written
//     are actually in the file, and exits non-zero if any are missing.
//   * `counts` aborts when the schema has no session-scoped table at all
//     (an empty or unmigrated file would otherwise print a clean table of
//     zeroes that looks like perfect isolation).
//   * `check` states the expected number for every cell it asserts, so a
//     query that silently matched nothing fails instead of passing.
//
//   usage:
//     node isolation.mjs plant  <db> <idA> <idB> <idGhost>
//     node isolation.mjs counts <db> [id...]
//     node isolation.mjs json   <db> [id...]
//     node isolation.mjs check  <db> <idA> <idB> <idGhost>
//     node isolation.mjs hammer <db> <idA> <idB> <rounds>
//
// ZAPO_REST_APP names the directory whose node_modules supplies
// better-sqlite3 (default: ../app beside this file).
import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const APP = process.env["ZAPO_REST_APP"] ?? join(HERE, "..", "app");
const req = createRequire(join(APP, "package.json"));
let Database;
try {
  Database = req("better-sqlite3");
} catch (err) {
  console.error(`ABORT: cannot load better-sqlite3 from ${APP}/node_modules: ${err.message}`);
  process.exit(2);
}

const SESSION_TABLES = [
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

const mode = process.argv[2];
const dbPath = process.argv[3];
if (!mode || !dbPath) {
  console.error("usage: isolation.mjs <plant|counts|json|check|hammer> <db> [...]");
  process.exit(2);
}
if (!existsSync(dbPath)) {
  console.error(`ABORT: no database at ${resolve(dbPath)} — the service has not created it yet`);
  process.exit(2);
}
const db = new Database(dbPath);
db.pragma("journal_mode = WAL");
db.pragma("busy_timeout = 10000");

function presentTables() {
  const rows = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all();
  const have = new Set(rows.map((r) => r.name));
  return SESSION_TABLES.filter((t) => have.has(t));
}

function countsFor(ids) {
  const tables = presentTables();
  if (tables.length === 0) {
    console.error(
      `ABORT: ${resolve(dbPath)} has none of the 21 session-scoped tables — ` +
        "a count over an unmigrated file is a table of zeroes, not an isolation result",
    );
    process.exit(2);
  }
  const out = { tables, perSession: {}, total: {}, orphan: {} };
  for (const t of tables) {
    out.total[t] = db.prepare(`SELECT COUNT(*) AS n FROM "${t}"`).get().n;
  }
  for (const id of ids) {
    const row = {};
    for (const t of tables) {
      row[t] = db.prepare(`SELECT COUNT(*) AS n FROM "${t}" WHERE session_id = ?`).get(id).n;
    }
    out.perSession[id] = row;
  }
  // Rows owned by nobody in `ids` — proves the per-session numbers add up.
  for (const t of tables) {
    let claimed = 0;
    for (const id of ids) claimed += out.perSession[id][t];
    out.orphan[t] = out.total[t] - claimed;
  }
  // Every distinct session_id actually in the file.
  const seen = new Set();
  for (const t of tables) {
    for (const r of db.prepare(`SELECT DISTINCT session_id FROM "${t}"`).all()) {
      if (typeof r.session_id === "string") seen.add(r.session_id);
    }
  }
  out.distinctIds = [...seen].sort();
  return out;
}

function printCounts(ids) {
  const c = countsFor(ids);
  const w = Math.max(34, ...c.tables.map((t) => t.length + 2));
  const cols = [...ids, "OTHER", "TOTAL"];
  let head = "table".padEnd(w);
  for (const k of cols) head += String(k).padStart(14);
  console.log(head);
  console.log("-".repeat(head.length));
  const sums = {};
  for (const k of cols) sums[k] = 0;
  for (const t of c.tables) {
    let line = t.padEnd(w);
    for (const id of ids) {
      line += String(c.perSession[id][t]).padStart(14);
      sums[id] += c.perSession[id][t];
    }
    line += String(c.orphan[t]).padStart(14);
    line += String(c.total[t]).padStart(14);
    sums["OTHER"] += c.orphan[t];
    sums["TOTAL"] += c.total[t];
    console.log(line);
  }
  console.log("-".repeat(head.length));
  let tot = "TOTAL rows".padEnd(w);
  for (const k of cols) tot += String(sums[k]).padStart(14);
  console.log(tot);
  console.log(`\ndistinct session_id values in the file: ${JSON.stringify(c.distinctIds)}`);
  console.log(`session-scoped tables present         : ${c.tables.length} of ${SESSION_TABLES.length}`);
  return c;
}

/* Deliberately ASYMMETRIC counts, so a query that dropped its session_id
 * qualifier returns a number that cannot be mistaken for the right one. */
const PLAN = {
  A: { threads: 3, messages: 5, contacts: 2 },
  B: { threads: 1, messages: 2, contacts: 4 },
  G: { threads: 7, messages: 9, contacts: 6 },
};

function plant(idA, idB, idGhost) {
  const spec = [
    [idA, PLAN.A, "A"],
    [idB, PLAN.B, "B"],
    [idGhost, PLAN.G, "G"],
  ];
  const have = new Set(presentTables());
  for (const t of ["mailbox_threads", "mailbox_messages", "mailbox_contacts"]) {
    if (!have.has(t)) {
      console.error(`ABORT: ${t} does not exist yet — start the service once so the mailbox migration runs`);
      process.exit(2);
    }
  }
  const now = Date.now();
  const insThread = db.prepare(
    "INSERT OR REPLACE INTO mailbox_threads (session_id, jid, name, unread_count) VALUES (?, ?, ?, ?)",
  );
  const insMsg = db.prepare(
    "INSERT OR REPLACE INTO mailbox_messages " +
      "(session_id, message_id, thread_jid, from_me, timestamp_ms, message_bytes) VALUES (?, ?, ?, ?, ?, ?)",
  );
  const insContact = db.prepare(
    "INSERT OR REPLACE INTO mailbox_contacts (session_id, jid, display_name, last_updated_ms) VALUES (?, ?, ?, ?)",
  );
  const tx = db.transaction(() => {
    for (const [id, plan, tag] of spec) {
      for (let i = 0; i < plan.threads; i++) {
        insThread.run(id, `${tag}${i}@s.whatsapp.net`, `${id} thread ${i}`, i);
      }
      for (let i = 0; i < plan.messages; i++) {
        insMsg.run(
          id,
          `${id}-msg-${i}`,
          `${tag}0@s.whatsapp.net`,
          0,
          now + i,
          Buffer.from(JSON.stringify({ owner: id, i })),
        );
      }
      for (let i = 0; i < plan.contacts; i++) {
        insContact.run(id, `${tag}c${i}@s.whatsapp.net`, `${id} contact ${i}`, now + i);
      }
    }
  });
  tx();

  // ARM: read the rows back and abort if the plant did not land.
  let bad = 0;
  for (const [id, plan] of spec) {
    const t = db.prepare("SELECT COUNT(*) AS n FROM mailbox_threads WHERE session_id = ?").get(id).n;
    const m = db.prepare("SELECT COUNT(*) AS n FROM mailbox_messages WHERE session_id = ?").get(id).n;
    const c = db.prepare("SELECT COUNT(*) AS n FROM mailbox_contacts WHERE session_id = ?").get(id).n;
    const ok = t === plan.threads && m === plan.messages && c === plan.contacts;
    if (!ok) bad += 1;
    console.log(
      `planted ${id.padEnd(10)} threads=${t}/${plan.threads} messages=${m}/${plan.messages} contacts=${c}/${plan.contacts} ${ok ? "ok" : "MISMATCH"}`,
    );
  }
  if (bad > 0) {
    console.error(`ABORT: ${bad} session(s) did not receive the rows this script claims to have written`);
    process.exit(1);
  }
}

function check(idA, idB, idGhost) {
  const ids = [idA, idB, idGhost];
  const c = countsFor(ids);
  let fails = 0;
  const expect = (what, got, want) => {
    const ok = got === want;
    if (!ok) fails += 1;
    console.log(`  ${ok ? "PASS" : "FAIL"}  ${what}: got ${got}, expected ${want}`);
  };
  console.log("assertions read straight from the database file:");
  const plans = { [idA]: PLAN.A, [idB]: PLAN.B, [idGhost]: PLAN.G };
  for (const id of ids) {
    expect(`${id} mailbox_threads`, c.perSession[id]["mailbox_threads"], plans[id].threads);
    expect(`${id} mailbox_messages`, c.perSession[id]["mailbox_messages"], plans[id].messages);
    expect(`${id} mailbox_contacts`, c.perSession[id]["mailbox_contacts"], plans[id].contacts);
  }
  expect(
    "mailbox_threads total equals the three sessions' sum",
    c.total["mailbox_threads"],
    PLAN.A.threads + PLAN.B.threads + PLAN.G.threads,
  );
  expect("no orphaned mailbox_threads row", c.orphan["mailbox_threads"], 0);
  expect("no orphaned mailbox_messages row", c.orphan["mailbox_messages"], 0);
  console.log(fails === 0 ? "\nALL DATABASE-SIDE ASSERTIONS PASS" : `\n${fails} DATABASE-SIDE ASSERTION(S) FAILED`);
  if (fails > 0) process.exit(1);
}

/* Two sessions writing at once through separate statements on ONE file, to
 * see what the store's serialisation does under contention. This writer is a
 * SECOND connection (the service holds the first), which is the harsher case:
 * within the service all sessions share one connection and better-sqlite3 is
 * synchronous, so they cannot interleave at all. */
function hammer(idA, idB, rounds) {
  const ins = db.prepare(
    "INSERT OR REPLACE INTO mailbox_threads (session_id, jid, name, unread_count) VALUES (?, ?, ?, ?)",
  );
  const started = Date.now();
  let busy = 0;
  for (let i = 0; i < rounds; i++) {
    for (const id of [idA, idB]) {
      try {
        ins.run(id, `hammer-${i}@s.whatsapp.net`, `${id} hammer ${i}`, i);
      } catch (err) {
        busy += 1;
        if (busy < 4) console.log(`  write contention: ${err.message}`);
      }
    }
  }
  const a = db.prepare("SELECT COUNT(*) AS n FROM mailbox_threads WHERE session_id = ? AND jid LIKE 'hammer-%'").get(idA).n;
  const b = db.prepare("SELECT COUNT(*) AS n FROM mailbox_threads WHERE session_id = ? AND jid LIKE 'hammer-%'").get(idB).n;
  console.log(`hammer: ${rounds} rounds x 2 sessions in ${Date.now() - started} ms`);
  console.log(`  ${idA} hammer rows: ${a} (expected ${rounds})`);
  console.log(`  ${idB} hammer rows: ${b} (expected ${rounds})`);
  console.log(`  failed writes    : ${busy}`);
  if (a !== rounds || b !== rounds) {
    console.error("ABORT: concurrent writes did not all land");
    process.exit(1);
  }
}

if (mode === "plant") plant(process.argv[4], process.argv[5], process.argv[6]);
else if (mode === "counts") printCounts(process.argv.slice(4));
else if (mode === "json") console.log(JSON.stringify(countsFor(process.argv.slice(4)), null, 2));
else if (mode === "check") check(process.argv[4], process.argv[5], process.argv[6]);
else if (mode === "hammer") hammer(process.argv[4], process.argv[5], Number(process.argv[6] ?? 50));
else {
  console.error(`unknown mode '${mode}'`);
  process.exit(2);
}
db.close();
