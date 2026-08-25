// The messaging axis with a REAL PERSISTENT STORE.
//
// messaging.bench.ts's four scenarios, unchanged in every respect except
// one: its `new Map<string, string>()` is a SQLite table. The pair is the
// measurement — same scenarios, same encode/digest work, same knobs, one
// difference — so the delta between the two files is the price of
// persistence and nothing else.
//
// The sibling's own header says "the in-process bench drives real
// libsignal sessions through better-sqlite3, and neither is in scriptc's
// lowered surface". Half of that is no longer true: better-sqlite3 IS in
// the lowered surface now (packages/runtime/src/scr_sqlite.c over the
// vendored amalgamation), so this file drives the same store the
// in-process suite does, in the same shape zapo's own store-sqlite uses
// it — WAL, synchronous=normal, a busy timeout, prepared statements
// cached for the process's life, and positional binding.
//
// WHAT THE MAP WAS HIDING. The Map is not a store, it is a leak with a
// get(): "SEND 1:1" never clears it, so its residency is the whole
// history of the run and its peak RSS is a function of how long the
// harness ran rather than of the work. The two group scenarios clear at
// 200,000 entries, which bounds them but also makes their steady state an
// artefact of that constant. A real store's residency is its page cache,
// which is a CONFIGURED number — so the memory question stops being "how
// long did it run" and becomes "how big is the cache", which is the
// answer a deployment can actually use.
//
// Knobs, beyond the sibling's:
//   BENCH_SQLITE_PATH   the database file (default: a temp file beside
//                       the process's cwd; ":memory:" is accepted and
//                       measures the engine WITHOUT the filesystem)
//   BENCH_SQLITE_CACHE  page-cache size in KIBIBYTES, as SQLite's
//                       negative `cache_size` spelling means it (default
//                       2000 = 2 MiB; the vendored build's own default is
//                       16 MiB, which would dominate every RSS number
//                       here and tell you about the default rather than
//                       about the work)
//   BENCH_SQLITE_TX     1 wraps each BATCH in one transaction. Default 0,
//                       because zapo's store-sqlite issues its bare
//                       writes OUTSIDE a transaction and the honest
//                       default is the shape the consumer actually has.
//   BENCH_GROUP_BOUND   how the group scenarios ask "am I over 200,000
//                       entries yet". Default "tracked"; "count"
//                       reproduces the first version of this file.
//
// WHY THAT KNOB EXISTS, measured and not supposed. The first version of
// this file spelled the group scenarios' 200,000-entry bound as
// `select count(*) from kv`, once per message, "kept so the two files do
// the same amount of work per batch". That sentence is false, and it is
// the single most expensive line in the file. The sibling's `store.size`
// is O(1) and free; `count(*)` is a full scan of the primary-key index,
// and at 200,000 rows with the default 2 MiB page cache the scan does not
// fit in cache, so each of the 1,000 calls per batch re-reads the index
// off disk. Measured on this host, compiled lane, SEND group, one batch:
//
//   bound = count,   cache 2 MiB     24,462 ms/batch     41 msgs/s
//   bound = count,   cache 200 MiB    3,042 ms/batch    329 msgs/s
//   bound = tracked, cache 2 MiB         see the report; the inserts alone
//
// So as first shipped, "SEND group over SQLite" measured `count(*)` and a
// thrashing page cache, not the store. The default is now the O(1)
// counter, which is what any real store keeps and what the sibling's Map
// gets for free — and it is the only spelling in which the two files
// differ ONLY in the store. `count` is retained so the old number can be
// reproduced rather than merely asserted.
//
// The counter is exact rather than an estimate: every key this file
// writes is fresh (`seq` is global and strictly increasing, and the group
// keys carry a "|" the 1:1 keys do not), so an upsert never collides and
// one increment per `run` is the row count. The ARMED CONTROL below
// checks that against a real `count(*)` at the end of the process and
// prints both, because an instrument that writes nothing and an
// instrument that writes and reports zero look identical from outside.

import { createHash } from "node:crypto"
import Database from "better-sqlite3"
import { runScenario, benchEnd, envInt, envStr } from "./_bench.ts"

const CONTACTS = envInt("ZAPO_BENCH_CONTACTS", 1000)
const GROUP_MEMBERS = envInt("ZAPO_BENCH_GROUP_MEMBERS", 500)
const MESSAGES = envInt("ZAPO_BENCH_MESSAGES", 1000)

const dbPath = envStr("BENCH_SQLITE_PATH", "bench-messaging.db")
const cacheKiB = envInt("BENCH_SQLITE_CACHE", 2000)
const useTx = envStr("BENCH_SQLITE_TX", "0") === "1"
const boundByCount = envStr("BENCH_GROUP_BOUND", "tracked") === "count"

const db = new Database(dbPath)
db.pragma("journal_mode = WAL")
db.pragma("synchronous = normal")
db.pragma("busy_timeout = 5000")
db.pragma("cache_size = -" + cacheKiB)
db.exec("create table if not exists kv (k TEXT PRIMARY KEY, v TEXT NOT NULL)")
db.exec("delete from kv")

// Prepared once, reused for the whole run — the statement cache zapo's
// connection wrapper keeps, spelled directly.
const kvSet = db.prepare("insert into kv (k, v) values (?, ?) on conflict(k) do update set v = excluded.v")
const kvGet = db.prepare("select v from kv where k = ?").pluck()
const kvSize = db.prepare("select count(*) as c from kv").pluck()
const kvClear = db.prepare("delete from kv")

// The O(1) row count a real store keeps. Every write goes through kvPut so
// the counter cannot drift from the table; kvOver() is the group bound.
let rows = 0

function kvPut(k: string, v: string): void {
  kvSet.run(k, v)
  rows++
}

function kvOver(limit: number): boolean {
  if (boundByCount) return (kvSize.get() as number) > limit
  return rows > limit
}

function kvWipe(): void {
  kvClear.run()
  rows = 0
}

function txBegin(): void {
  if (useTx) db.exec("BEGIN")
}
function txEnd(): void {
  if (useTx) db.exec("COMMIT")
}

const jids: string[] = []
for (let i = 0; i < CONTACTS; i++) jids.push("5511" + (900000000 + i) + "@s.whatsapp.net")

const groupJid = "120363000000000001@g.us"
const members: string[] = []
for (let i = 0; i < GROUP_MEMBERS; i++) members.push(jids[i % jids.length])

let seq = 0

function encodeMessage(to: string, text: string, id: string): string {
  return (
    '{"key":{"remoteJid":"' + to + '","fromMe":true,"id":"' + id + '"},' +
    '"message":{"conversation":"' + text + '"},' +
    '"messageTimestamp":' + (1700000000 + seq) + "}"
  )
}

function digest(s: string): string {
  return createHash("sha256").update(s).digest("hex")
}

// ── SEND 1:1 ─────────────────────────────────────────────────────────
runScenario("SEND 1:1", "msgs", MESSAGES, () => {
  txBegin()
  for (let i = 0; i < MESSAGES; i++) {
    seq++
    const to = jids[seq % jids.length]
    const id = "3EB0" + seq
    const wire = encodeMessage(to, "hello-" + seq, id)
    kvPut(id, digest(wire))
  }
  txEnd()
})

// ── RECV 1:1 ─────────────────────────────────────────────────────────
runScenario("RECV 1:1", "msgs", MESSAGES, () => {
  txBegin()
  for (let i = 0; i < MESSAGES; i++) {
    seq++
    const from = jids[seq % jids.length]
    const id = "3EB0" + seq
    const wire = encodeMessage(from, "inbound-" + seq, id)
    const parsed = JSON.parse(wire) as { key: { id: string } }
    const rid = parsed.key.id
    kvPut(rid, digest(rid))
    kvGet.get(rid)
  }
  txEnd()
})

// ── SEND group ───────────────────────────────────────────────────────
// One plaintext, fanned out to every member: the group send's real cost.
runScenario("SEND group", "msgs", MESSAGES, () => {
  txBegin()
  for (let i = 0; i < MESSAGES; i++) {
    seq++
    const wire = encodeMessage(groupJid, "group-" + seq, "3EB0" + seq)
    const d = digest(wire)
    for (let m = 0; m < members.length; m++) {
      kvPut(members[m] + "|" + seq, d)
    }
    // The sibling's `store.size > 200000` bound. Under the default
    // "tracked" spelling this is the same O(1) question the Map answers;
    // under "count" it is the full-scan version the file first shipped
    // with. See the header for what that difference costs.
    if (kvOver(200000)) kvWipe()
  }
  txEnd()
})

// ── RECV group ───────────────────────────────────────────────────────
runScenario("RECV group", "msgs", MESSAGES, () => {
  txBegin()
  for (let i = 0; i < MESSAGES; i++) {
    seq++
    const wire = encodeMessage(groupJid, "grecv-" + seq, "3EB0" + seq)
    const parsed = JSON.parse(wire) as { message: { conversation: string } }
    const text = parsed.message.conversation
    kvPut(groupJid + "|" + seq, digest(text))
    if (kvOver(200000)) kvWipe()
  }
  txEnd()
})

// ── the armed control ────────────────────────────────────────────────
// An inert instrument and a true zero are indistinguishable without one.
// This asks the DATABASE how many rows are really in it, next to the
// counter the run maintained, and prints the file it wrote to.
const realRows = kvSize.get() as number
console.log(
  "SCBENCH-ROWS {" +
    '"path":"' + dbPath + '"' +
    ',"rowsTracked":' + rows +
    ',"rowsInTable":' + realRows +
    ',"agree":' + (rows === realRows ? "true" : "false") +
    ',"bound":"' + (boundByCount ? "count" : "tracked") + '"' +
    ',"tx":' + (useTx ? "1" : "0") +
    ',"cacheKiB":' + cacheKiB +
    "}"
)

db.close()
benchEnd()
