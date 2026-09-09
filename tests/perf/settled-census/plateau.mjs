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
 * concurrency question.
 *
 * IT IS NOT A REFUTATION OF THE 2.7 KB FIGURE, and calling it one would be
 * comparing two different quantities. That figure is bytes per retained
 * EVENT IN THE RING, derived from a 2.66 MiB delta over ~1,000 ring
 * entries on the no-buffer arm. This slope is the marginal live heap per
 * additional MESSAGE delivered, across every structure that retains one,
 * and README-183 records that the ring never held the payloads at all --
 * push() and rememberMessage() receive the same object and the typed array
 * retains it independently. Different structures, different populations:
 * both can be right and neither tests the other.
 *
 * WHAT DOES FOLLOW, and it needs no comparison: the TOTAL marginal cost of
 * every retained message is 12.69 MiB at 19,200 messages, which is smaller
 * than the 36.51 MiB of fragmentation it was supposed to dwarf. The live
 * side is not what dominates, whatever any per-event figure says.
 *
 * THE FLOOR IS THE BINARY -- IN THE TOTAL COLUMN, WHICH IS NOT THE ONE THE
 * USER IS READING. Both halves of that matter and neither cancels the other.
 *
 * Total presync working set is 32.08 MiB against a 30.61 MiB executable, so
 * in THAT column the binary is a floor and no allocator work can move it.
 * But a mapped image is FILE-BACKED, not private, and Task Manager's
 * Processes tab reports the private working set. Measured on the shipped
 * arm with pmon's privateWS column:
 *
 *              total WS   private WS   private commit
 *   idle          32.08        13.30            18.49
 *   settled      104.48        84.59           198.84
 *
 * "idle 10 MB, 70-100 MB after a sync" fits 13.30 and 84.59; it does not
 * fit 32.08. So the user is reading private working set, the binary is not
 * in their number, and the retention they see is 71.29 MiB rather than
 * 72.40 of a 104 MiB total.
 *
 * THE CONSEQUENCE IS IN OUR FAVOUR, and it is why the column had to be
 * checked before writing anything to them: fragmentation is 36.51 MiB, so
 * it is 51% of the retention they can see, and the 24.86 MiB of
 * page-shaped discard -- which returns WORKING SET, exactly this column --
 * is 35% of their complaint rather than the 24% of a total-WS denominator.
 */
const NL = String.fromCharCode(10)
const MiB = 1024 * 1024
const mib = (b) => (b / MiB).toFixed(2)

/* Measured inputs, each with the run that produced it. Kept as literals
 * with their provenance rather than re-derived, because the runs they come
 * from are committed under evidence-llvm182/ and evidence-sweep/ and a
 * reader that recomputed them would drift from what was actually observed. */
const M = {
  /* THREE COLUMNS, NEVER ONE. workingSet is the TOTAL and includes
   * file-backed shared pages; privateWs excludes them and is what Task
   * Manager's Processes tab shows; privateCommit is the charge against
   * the commit limit. They differ by 2-3x here and this objective is
   * denominated in the second. Measured on the shipped arm, run
   * `privws`, 385 samples, none unreadable. */
  settledWs:   104.48 * MiB,  // total
  settledPriv:  84.59 * MiB,  // PRIVATE — the user's column
  presyncPriv:  13.30 * MiB,  // idle, private
  settledCommit: 198.84 * MiB,
  presync:      32.08 * MiB,  // idle, TOTAL (7 runs, 31.99-32.52)
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
  'total retained payload is under a quarter of the plateau (' +
  (100 * payload / M.settledWs).toFixed(1) + '%). NOT compared to the 2.7 KB/event ' +
  'figure: that is per RING ENTRY and this is per MESSAGE, different structures')
ok(M.presync > 0.9 * M.exe,
  'the idle floor is the BINARY: presync ' + mib(M.presync) + ' MiB against a ' +
  mib(M.exe) + ' MiB executable')

/* WHAT IS ACTUALLY OWNABLE, recomputed after five routes closed. This
 * block previously offered the page-shaped figure as a deliverable; that
 * measure was run-merged and unsafe, and CRT-heap discard has since been
 * refuted outright. Nothing here rests on it.
 *
 * Closed: zapo-side serialisation (works -- -62% peak WS, -75% commit,
 * -48% settled, and faster -- but forbidden, it patches zapo), copy-out
 * (no handle indirection, nothing can move), sub-heaps (refuted, every
 * HeapCreate reserves its own region), CRT-heap page discard (refuted),
 * and raising SCR_POOL_MAX (refuted -- the Windows LFH already buckets to
 * 16 KB, so those blocks were never unrecycled, only unrecycled by us).
 *
 * What is left is what we allocate ourselves, where no LFH or foreign
 * metadata objection applies. */
const ownCycPages = 2.31 * MiB   // pagecen CEILING aligned, settled, run privws
const ownStr      = M.strArena   // unfreeable BY CONSTRUCTION; a registry fixes it
const retention   = M.settledPriv - M.presyncPriv

console.log(NL + 'in PRIVATE working set — the column Task Manager shows and the user quoted:')
console.log('  idle              ' + mib(M.presyncPriv) + ' MiB   (their "10 MB")')
console.log('  settled           ' + mib(M.settledPriv) + ' MiB   (their "70-100 MB")')
console.log('  retention         ' + mib(retention) + ' MiB' + NL)
console.log('  what it is made of, in their column:')
console.log('    fragmentation         ' + mib(M.crtFree) + ' MiB  ' +
  (100 * M.crtFree / retention).toFixed(0) + '%  cause is CONCURRENT chunk processing;')
console.log('                                        the fix that works is zapo-side and forbidden')
console.log('    retained messages     ' + mib(payload) + ' MiB  ' +
  (100 * payload / retention).toFixed(0) + '%  data the program was asked to keep')
console.log('    service state         ' + mib(M.liveFixed) + ' MiB  ' +
  (100 * M.liveFixed / retention).toFixed(0) + '%')
console.log('    our own arenas        ' + mib(M.cycArena + M.strArena) + ' MiB  ' +
  (100 * (M.cycArena + M.strArena) / retention).toFixed(0) + '%  cycle ' +
  mib(M.cycArena) + ' + string ' + mib(M.strArena))
console.log(NL + '  OWNABLE TODAY, with every refuted route removed:')
console.log('    cycle arena page return   ' + mib(ownCycPages) +
  ' MiB   ours, 61.25% occupancy, no foreign metadata')
console.log('    string arena chunks       up to ' + mib(ownStr) +
  ' MiB   never recycles at all (listgive=0); needs a registry')
console.log('    total                     ' + mib(ownCycPages + ownStr) + ' MiB = ' +
  (100 * (ownCycPages + ownStr) / retention).toFixed(1) + '% of what the user sees')
console.log(NL + 'in TOTAL working set, where the binary IS a floor:')
console.log('  idle ' + mib(M.presync) + ' MiB against a ' + mib(M.exe) +
  ' MiB executable; the image is file-backed and is')
console.log('  therefore NOT in the private column above. Both statements hold.')

ok(M.presyncPriv < M.presync * 0.5,
  'private idle (' + mib(M.presyncPriv) + ') is under half of total idle (' + mib(M.presync) +
  ') — the columns differ by the resident image and must never be conflated')
ok((ownCycPages + ownStr) < M.crtFree,
  'what we can own (' + mib(ownCycPages + ownStr) + ' MiB) is far less than the fragmentation (' +
  mib(M.crtFree) + ' MiB) — the bulk of the retention is not reachable from the runtime')

if (ran < 6) { console.log(NL + 'REFUSED: only ' + ran + ' checks ran'); process.exit(2) }
console.log(NL + (fails ? 'PLATEAU FAILED (' + fails + ')' : 'PLATEAU OK'))
process.exit(fails ? 1 : 0)
