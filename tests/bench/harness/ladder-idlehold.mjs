/* ladder-idlehold.mjs - hold the messaging bench idle with the connection up (LAB, bench ref only).
 *
 *   node ladder-idlehold.mjs <bench-dir>
 *
 * After the pairing line ("paired in ...") the program waits ZAPO_BENCH_IDLE_SECONDS seconds, bracketed by the phase markers pmon records, then goes on. Unset, the wait is skipped
 * and the program is unchanged. The client keeps its connection alive with its own keepalive pings and nothing else happens: that is what the idle RSS of a compiled messaging app is.
 * A measurement patch to a COPY; zapo is read-only test input.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
const dir = process.argv[2]
if (dir === undefined) { console.error('usage: ladder-idlehold.mjs <bench-dir>'); process.exit(2) }
const file = join(dir, 'messaging.bench.ts')
const text = readFileSync(file, 'utf8')
if (text.includes('[phase-begin] idle')) { console.error('already patched'); process.exit(4) }
const anchor = "    console.log(`paired in ${formatMs(performance.now() - setupStart)}`)\n"
if (!text.includes(anchor)) { console.error('the pairing line this patch expects is gone'); process.exit(5) }
const add = anchor + "    if (process.env.ZAPO_BENCH_IDLE_SECONDS) {\n        console.log('[phase-begin] idle')\n        await new Promise((r) => setTimeout(r, Number(process.env.ZAPO_BENCH_IDLE_SECONDS) * 1000))\n        console.log('[phase-end] idle')\n    }\n"
const out = text.replace(anchor, add)
if (out === text || !out.includes('[phase-begin] idle')) { console.error('self-test: the patch changed nothing'); process.exit(6) }
writeFileSync(file, out)
console.log('idlehold applied')
