// The messaging axis, cross-runtime.
//
// Scenario names are deliberately IDENTICAL to the in-process suite's
// (packages/fake-server/bench/native-backend-matrix.cjs scenarioOrder:
// "SEND 1:1", "RECV 1:1", "SEND group", "RECV group") so a reader can put
// the two tables side by side. The WORK is not identical and cannot be:
// the in-process bench drives real libsignal sessions through
// better-sqlite3, and neither is in scriptc's lowered surface. What is
// reproduced is the SHAPE of the work per message - assemble a record,
// serialise it, digest it, put it in a keyed store, read it back - which is
// what the compiled program actually spends its time on.
//
// Load knobs mirror the existing ZAPO_BENCH_* names where they mean the
// same thing.
//
// BENCH_GROUP_BOUND exists only so this file stays line-for-line the
// sibling of messaging-sqlite.bench.ts, which needs it: `store.size` here
// is O(1), and the SQLite spelling of the same question was a full index
// scan per message. Both settings are O(1) HERE and the numbers must not
// move between them — which is itself worth checking, and is checked in
// the report.

import { createHash } from "node:crypto"
import { runScenario, benchEnd, envInt, envStr, jstr } from "./_bench.ts"

const CONTACTS = envInt("ZAPO_BENCH_CONTACTS", 1000)
const GROUP_MEMBERS = envInt("ZAPO_BENCH_GROUP_MEMBERS", 500)
const MESSAGES = envInt("ZAPO_BENCH_MESSAGES", 1000)

const jids: string[] = []
for (let i = 0; i < CONTACTS; i++) jids.push("5511" + (900000000 + i) + "@s.whatsapp.net")

const groupJid = "120363000000000001@g.us"
const members: string[] = []
for (let i = 0; i < GROUP_MEMBERS; i++) members.push(jids[i % jids.length])

const store = new Map<string, string>()
let seq = 0

const boundByCount = envStr("BENCH_GROUP_BOUND", "tracked") === "count"

// The sibling's O(1) row counter, spelled here so the two files differ
// only in the store. Every key this file writes is fresh (`seq` is global
// and strictly increasing, and the group keys carry a "|" the 1:1 keys do
// not), so one increment per set is the entry count.
let rows = 0

function kvPut(k: string, v: string): void {
  store.set(k, v)
  rows++
}

function kvOver(limit: number): boolean {
  if (boundByCount) return store.size > limit
  return rows > limit
}

function kvWipe(): void {
  store.clear()
  rows = 0
}

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
  for (let i = 0; i < MESSAGES; i++) {
    seq++
    const to = jids[seq % jids.length]
    const id = "3EB0" + seq
    const wire = encodeMessage(to, "hello-" + seq, id)
    kvPut(id, digest(wire))
  }
})

// ── RECV 1:1 ─────────────────────────────────────────────────────────
runScenario("RECV 1:1", "msgs", MESSAGES, () => {
  for (let i = 0; i < MESSAGES; i++) {
    seq++
    const from = jids[seq % jids.length]
    const id = "3EB0" + seq
    const wire = encodeMessage(from, "inbound-" + seq, id)
    const parsed = JSON.parse(wire)
    const rid = parsed.key.id
    kvPut(rid, digest(rid))
    store.get(rid)
  }
})

// ── SEND group ───────────────────────────────────────────────────────
// One plaintext, fanned out to every member: the group send's real cost.
runScenario("SEND group", "msgs", MESSAGES, () => {
  for (let i = 0; i < MESSAGES; i++) {
    seq++
    const wire = encodeMessage(groupJid, "group-" + seq, "3EB0" + seq)
    const d = digest(wire)
    for (let m = 0; m < members.length; m++) {
      kvPut(members[m] + "|" + seq, d)
    }
    if (kvOver(200000)) kvWipe()
  }
})

// ── RECV group ───────────────────────────────────────────────────────
runScenario("RECV group", "msgs", MESSAGES, () => {
  for (let i = 0; i < MESSAGES; i++) {
    seq++
    const wire = encodeMessage(groupJid, "grecv-" + seq, "3EB0" + seq)
    const parsed = JSON.parse(wire)
    const text = parsed.message.conversation
    kvPut(groupJid + "|" + seq, digest(text))
    if (kvOver(200000)) kvWipe()
  }
})

// The armed control, the sibling's shape: the counter next to what the
// store itself says it holds.
console.log(
  "SCBENCH-ROWS {" +
    '"path":' + jstr("(map)") +
    ',"rowsTracked":' + rows +
    ',"rowsInTable":' + store.size +
    ',"agree":' + (rows === store.size ? "true" : "false") +
    ',"bound":' + jstr(boundByCount ? "count" : "tracked") +
    "}"
)

benchEnd()
