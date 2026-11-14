/* ladder-dealonce.mjs — the fake server's pre-key dispenser can be told never to deal the same key id twice.
 *
 *   node ladder-dealonce.mjs [<fake-server-dir>]
 *
 * Why: zapo uploads its pre-keys more than once at start-up (the login upload, then the digest-validation re-upload of the SAME ids 1..812, then a second
 * batch 813..1624), and PreKeyDispenser.captureBundle resets the dispenser cursor to 0 on every upload. When the second upload of the same list reaches the
 * server after the first peers were already dealt keys, those ids are dealt AGAIN: two peers hold the same one-time pre-key, the second message fails with
 * "prekey 1 not found" (the client consumed it for the first peer) and RECV 1:1 stalls at 199/200. Whether it happens depends only on the gap between the two
 * uploads (the client's read-back of its stored pre-keys): Node about 28 ms (no duplicate), the compiled arm 87-114 ms (duplicate), and Node itself fails the
 * same way once its Redis commands are delayed by 10-30 ms (MEASURED 2026-11-10, docs/fake-server.md). It is a race in zapo + the fake server, not a
 * compiler defect.
 *
 * What: with ZAPO_BENCH_DEAL_ONCE=1 the dispenser remembers the key ids it has dealt and skips them after a re-capture. UNSET the behaviour is byte-for-byte
 * what it was. Use the SAME value on every arm of an A/B, Node included, and say so in the report.
 *
 * This is a MEASUREMENT patch to the rig's COPY of the fake server ($BENCH_WORK/app/tree/packages/fake-server), never to the user's app.
 * Idempotent: a second run finds the marker and changes nothing.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const root = process.argv[2] ?? join(process.env.BENCH_WORK, 'app/tree/packages/fake-server')
const p = join(root, 'src/api/PreKeyDispenser.ts')
const MARK = 'ZAPO_BENCH_DEAL_ONCE'
let s = readFileSync(p, 'utf8')
if (s.includes(MARK)) { console.log('PreKeyDispenser.ts: dealonce already patched'); process.exit(0) }
const steps = [
  [
    "interface PendingPreKeyBundleWaiter {",
    "// ZAPO_BENCH_DEAL_ONCE=1: never deal a key id twice (a re-capture of the same list must not hand out ids already dealt). Unset = original behaviour.\nconst PREKEY_DEAL_ONCE = process.env['ZAPO_BENCH_DEAL_ONCE'] === '1'\n\ninterface PendingPreKeyBundleWaiter {",
  ],
  [
    "    private preKeyDispenserCursor = 0\n",
    "    private preKeyDispenserCursor = 0\n    private readonly dealtKeyIds = new Set<number>()\n",
  ],
  [
    "        if (this.preKeyDispenserCursor >= bundle.preKeys.length) {\n            this.preKeyDispenserMisses += 1\n            return null\n        }\n        const entry = bundle.preKeys[this.preKeyDispenserCursor]\n        this.preKeyDispenserCursor += 1\n        return { keyId: entry.keyId, publicKey: entry.publicKey }",
    "        while (this.preKeyDispenserCursor < bundle.preKeys.length) {\n            const entry = bundle.preKeys[this.preKeyDispenserCursor]\n            this.preKeyDispenserCursor += 1\n            if (PREKEY_DEAL_ONCE) {\n                if (this.dealtKeyIds.has(entry.keyId)) continue\n                this.dealtKeyIds.add(entry.keyId)\n            }\n            return { keyId: entry.keyId, publicKey: entry.publicKey }\n        }\n        this.preKeyDispenserMisses += 1\n        return null",
  ],
]
for (const [from, to] of steps) {
  if (!s.includes(from)) { console.error(`PreKeyDispenser.ts: expected text not found: ${from.slice(0, 60)}`); process.exit(1) }
  s = s.replace(from, to)
}
writeFileSync(p, s)
console.log('PreKeyDispenser.ts: dealonce patched')
