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

import { createHash } from "node:crypto"
import Database from "better-sqlite3"
import { runScenario, benchEnd, envInt, envStr } from "./_bench.ts"

const CONTACTS = envInt("ZAPO_BENCH_CONTACTS", 1000)
const GROUP_MEMBERS = envInt("ZAPO_BENCH_GROUP_MEMBERS", 500)
const MESSAGES = envInt("ZAPO_BENCH_MESSAGES", 1000)

const dbPath = envStr("BENCH_SQLITE_PATH", "bench-messaging.db")
const cacheKiB = envInt("BENCH_SQLITE_CACHE", 2000)
const useTx = envStr("BENCH_SQLITE_TX", "0") === "1"

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
    kvSet.run(id, digest(wire))
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
    kvSet.run(rid, digest(rid))
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
      kvSet.run(members[m] + "|" + seq, d)
    }
    // The sibling's `store.size > 200000` bound, kept so the two files
    // do the same amount of work per batch. A real store would not do
    // this at all; the point of the pair is that only the STORE differs.
    if ((kvSize.get() as number) > 200000) kvClear.run()
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
    kvSet.run(groupJid + "|" + seq, digest(text))
    if ((kvSize.get() as number) > 200000) kvClear.run()
  }
  txEnd()
})

db.close()
benchEnd()
