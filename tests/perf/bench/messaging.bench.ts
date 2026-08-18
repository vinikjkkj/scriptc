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

import { createHash } from "node:crypto"
import { runScenario, benchEnd, envInt } from "./_bench.ts"

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
    store.set(id, digest(wire))
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
    store.set(rid, digest(rid))
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
      store.set(members[m] + "|" + seq, d)
    }
    if (store.size > 200000) store.clear()
  }
})

// ── RECV group ───────────────────────────────────────────────────────
runScenario("RECV group", "msgs", MESSAGES, () => {
  for (let i = 0; i < MESSAGES; i++) {
    seq++
    const wire = encodeMessage(groupJid, "grecv-" + seq, "3EB0" + seq)
    const parsed = JSON.parse(wire)
    const text = parsed.message.conversation
    store.set(groupJid + "|" + seq, digest(text))
    if (store.size > 200000) store.clear()
  }
})

benchEnd()
