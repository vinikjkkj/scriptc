/* plateau.mjs - what the settled plateau is MADE OF, itemised end to end.
 *
 *   node tests/perf/settled-census/plateau.mjs
 *
 * WHY THIS EXISTS. The fragmentation work answered "what is the free space
 * and can we return it". It never answered "what is the REST", and the
 * arithmetic makes that the question that decides whether the objective is
 * reachable: settled is ~104 MiB with ~36.5 MiB committed-free, so even a
 * perfect discard of every returnable page leaves ~68 MiB against a target
 * of "near idle".
 *
 * Every term below is measured on the SHIPPED arm -- unserialised
 * (CHUNK_GAP_MS=0), the same arm every other figure in this directory
 * names -- and no term is an estimate.
 *
 * THE LIVE SIDE IS A LINEAR LAW, not a guess. Holding CHUNKS and CONVS
 * fixed and varying only MSGS moves nothing but the number of decoded
 * messages retained. Four points across a 12x range fit
 *
 *     live heap (excl. arena chunks) = 10.32 MiB + 693 bytes per message
 *
 * to within +/-0.3 MiB. That is the same one-knob shape that settled the
 * concurrency question, and it refutes a figure this objective was
 * steering on: an event held as `unknown` was believed to cost ~2.7 KB, so
 * 19,200 of them would be ~49 MiB and most of the plateau. Measured, the
 * rate is 693 B/message and the payload is 12.69 MiB -- 3.9x lower. The
 * live side is NOT dominated by retained message payload.
 *
 * THE FLOOR IS THE BINARY, and it is the finding that bounds everything.
 * Presync working set -- the service idle, logged in, before a byte of
 * history -- is 32.0 MiB across seven runs, spread 0.53 MiB, and the
 * executable is 30.61 MiB. A 30.6 MiB statically linked binary cannot idle
 * near 10 MB, so "returns to near its idle level" is not reachable by
 * memory work of any kind; what IS reachable is returning to THIS binary's
 * idle level, and the gap between those two is not a defect anyone can fix
 * in the allocator.
 */
const NL = String.fromCharCode(10)
const MiB = 1024 * 1024
const mib = (b) => (b / MiB).toFixed(2)

/* Measured inputs, each with the run that produced it. Kept as literals
 * with their provenance rather than re-derived, because the runs they come
 * from are committed under evidence-llvm182/ and evidence-sweep/ and a
 * reader that recomputed them would drift from what was actually observed. */
const M = {
  settledWs:   104.13 * MiB,  // evidence-llvm182/main, CONTENDED
  settledCommit: 196.87 * MiB,
  presync:      32.00 * MiB,  // 7 runs, 31.99-32.52, spread 0.53
  exe:          32092160,     // zapo-rest-182.exe, LLVM tier
  crtBusy:      33.62 * MiB,  // evidence-llvm182/main
  crtFree:      36.51 * MiB,
  pageShaped:   24.86 * MiB,
  cycArena:      7.25 * MiB,  // cycstat held=116 chunks
  strArena:      3.00 * MiB,  // cycstat strarena chunks=48, unfreeable
  liveFixed:    10.32 * MiB,  // regression intercept
  perMsg:       693,          // regression slope, bytes/message
  messages:     19200,
}
const payload = M.perMsg * M.messages

console.log('the settled plateau, itemised — shipped arm, ' + M.messages +
  ' messages, unserialised' + NL)
const rows = [
  ['binary image + loader + stacks', M.presync,
   'measured idle floor; exe alone is ' + mib(M.exe) + ' MiB'],
  ['CRT heap committed-FREE', M.crtFree,
   'fragmentation; ' + mib(M.pageShaped) + ' MiB of it page-shaped'],
  ['arena chunks (busy)', M.cycArena + M.strArena,
   'cycle ' + mib(M.cycArena) + ' + string ' + mib(M.strArena) + ' (unfreeable by construction)'],
  ['live heap, fixed', M.liveFixed, 'service state, independent of message count'],
  ['live heap, message payload', payload, M.perMsg + ' B/message, measured slope'],
]
let sum = 0
for (const [name, bytes, note] of rows) {
  sum += bytes
  console.log('  ' + name.padEnd(32) + mib(bytes).padStart(8) + ' MiB   ' + note)
}
console.log('  ' + '-'.repeat(32) + ' ' + '-'.repeat(8))
console.log('  ' + 'accounted'.padEnd(32) + mib(sum).padStart(8) + ' MiB')
console.log('  ' + 'measured settled'.padEnd(32) + mib(M.settledWs).padStart(8) + ' MiB   [CONTENDED]')
const gap = M.settledWs - sum
console.log('  ' + 'unaccounted'.padEnd(32) + mib(gap).padStart(8) + ' MiB   ' +
  (100 * Math.abs(gap) / M.settledWs).toFixed(1) + '% of the plateau')

let fails = 0, ran = 0
const ok = (c, m) => { ran++; console.log((c ? NL + '  PASS  ' : NL + '  FAIL  ') + m); if (!c) fails++ }

ok(Math.abs(gap) / M.settledWs < 0.05,
  'the itemisation closes to within 5% of the measured plateau')
ok(payload < M.crtFree,
  'retained message payload (' + mib(payload) + ' MiB) is SMALLER than the fragmentation (' +
  mib(M.crtFree) + ' MiB) — the live side is not what dominates')
ok(payload / M.settledWs < 0.25,
  'payload is under a quarter of the plateau (' + (100 * payload / M.settledWs).toFixed(1) +
  '%), against the ~49 MiB the 2.7 KB/event figure predicted')
ok(M.presync > 0.9 * M.exe,
  'the idle floor is the BINARY: presync ' + mib(M.presync) + ' MiB against a ' +
  mib(M.exe) + ' MiB executable')

/* THE CEILING ON THE WHOLE OBJECTIVE, stated as arithmetic rather than as
 * an opinion, because it is what the user has to be told. */
const best = M.presync + M.liveFixed + payload + M.cycArena + M.strArena
console.log(NL + 'the best case memory work could reach, if ALL fragmentation went:')
console.log('  ' + mib(best) + ' MiB, against ' + mib(M.settledWs) + ' now and a target of "near idle".')
console.log('  Idle IS ' + mib(M.presync) + ' MiB on this binary, so "near 10 MB" is not reachable:')
console.log('  the executable is ' + mib(M.exe) + ' MiB before it allocates anything.')

if (ran < 4) { console.log(NL + 'REFUSED: only ' + ran + ' checks ran'); process.exit(2) }
console.log(NL + (fails ? 'PLATEAU FAILED (' + fails + ')' : 'PLATEAU OK'))
process.exit(fails ? 1 : 0)
