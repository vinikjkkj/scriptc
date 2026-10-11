/* plateau.mjs - what the settled plateau is MADE OF, itemised end to end.
 *
 *   node tests/perf/settled-census/plateau.mjs
 *
 * SCOPE -- WINDOWS INSTRUMENT, STANDALONE ANALYSIS. Nothing imports this
 * file and nothing runs it: `tests/perf/**` is outside vitest's includes
 * (`vitest.config.ts:49-53`) and no CI job invokes it. Do not read the
 * repair below as something a gate covers. It is here because this file is
 * CITED AS EVIDENCE -- `nonheap/scr_nonheap.h:14,33,41,49` and
 * `boxanat/README.md:851,855` -- and a wrong number in a cited artifact
 * does not have to run in order to do damage.
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
  /* CEILING, NOT COMMIT -- and the qualifier is in the IDENTIFIER on
   * purpose. This is HeapWalk's `free` column, which mixes committed
   * pages with pages the NT heap has already returned to the OS without
   * emitting PROCESS_HEAP_UNCOMMITTED_RANGE (band at the foot of this
   * file). It spread into 23 documents as "committed-free" because the
   * old name `crtFree` carried no qualifier: a COMMENT does not travel
   * with a value, an IDENTIFIER does. The committed part of it is
   * UNMEASURED and is of order 1-4 MiB. */
  crtFreeCeiling: 36.51 * MiB,
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
  /* `crtFreeCeiling` WAS A LINE ITEM HERE AND IS NOT ANY MORE. This is an
   * itemisation of what the process HOLDS; a ceiling is not a quantity of
   * paid bytes and cannot be added to one. It is reported beside the
   * table instead, as the bound it actually is. */
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

console.log('  ' + 'free-ceiling (NOT summed)'.padEnd(32) + mib(M.crtFreeCeiling).padStart(8) +
  ' MiB   UPPER BOUND on heap free space, not a paid term; committed part UNMEASURED')
/* `pageShaped` is kept and reported because it is a measured figure with its
 * own provenance, and dropping its last reference would lose it. But it is a
 * share of the CEILING, so it inherits the ceiling's defect: it bounds what
 * could be page-shaped, not what is committed and page-shaped. */
console.log('  ' + '  of which page-shaped'.padEnd(32) + mib(M.pageShaped).padStart(8) +
  ' MiB   a share OF THE CEILING, so also a bound -- not a recoverable quantity')

let fails = 0, ran = 0, unmeasured = 0
const ok = (c, m) => { ran++; console.log((c ? NL + '  PASS  ' : NL + '  FAIL  ') + m); if (!c) fails++ }
/* UNMEASURED IS NOT A PASS. It does not touch `ran` and it does not touch
 * `fails`; it is counted on a line of its own so that an open item cannot
 * quietly vanish from the output and be forgotten. */
const unmeas = (m) => { unmeasured++; console.log(NL + '  UNMEASURED  ' + m) }

unmeas('the itemisation does NOT close: ' + mib(gap) + ' MiB (' +
  (100 * Math.abs(gap) / M.settledWs).toFixed(1) + '%) is unaccounted. The old check here\n' +
  '              asserted closure within 5%, and it only closed because the 36.51 MiB\n' +
  '              CEILING was summed in as though it were paid. Re-deriving this needs an\n' +
  '              EXTERNAL measure of the same instant (PrivateUsage, the way\n' +
  '              pagecensus/evidence-rest does it), which has NOT been run for this arm.')
unmeas('whether the retained payload (' + mib(payload) + ' MiB) is smaller than the\n' +
  '              COMMITTED free space is UNMEASURED. The old check compared it against the\n' +
  '              ' + mib(M.crtFreeCeiling) + ' MiB CEILING, which is VACUOUS: a payload is always under a\n' +
  '              bound that overstates. See THE PLANT below, and the RETRACTED COLUMN\n' +
  '              band at the foot of this file.')
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
console.log('  idle              ' + mib(M.presyncPriv) + ' MiB   NOT A FLOOR: sampled 15 s')
console.log('                                 after login, still falling; the shipping arm')
console.log('                                 spans 12-24 MiB across 12 runs. A long-settled')
console.log('                                 idle has never been measured, and their')
console.log('                                 "10 MB" is compatible with one.')
console.log('  settled           ' + mib(M.settledPriv) + ' MiB   (their "70-100 MB")')
console.log('  retention         ' + mib(retention) + ' MiB' + NL)
console.log('  what it is made of, in their column:')
console.log('    free-ceiling          ' + mib(M.crtFreeCeiling) + ' MiB <=' +
  (100 * M.crtFreeCeiling / retention).toFixed(0) + '%  NOT "fragmentation", NOT a paid term:')
console.log('                                        an UPPER BOUND. The committed share is')
console.log('                                        UNMEASURED (order 1-4 MiB), so the % is a')
console.log('                                        bound too. Concurrent chunk processing is')
console.log('                                        the cause of the free SPACE; the fix that')
console.log('                                        works is zapo-side and forbidden.')
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
console.log('      ...but "up to" is doing real work in that sentence. The cycle arena')
console.log('      ALREADY has the chunk list this fix would add, and it still holds')
console.log('      7.25 MiB at 61% occupancy, because chunks rarely reach used==0. The')
console.log('      string arena inherits exactly that placement problem, so the yield')
console.log('      may be considerably under 3 MiB. The fix is correct and necessary;')
console.log('      its SIZE is not established, and the handover must not imply it is.')
console.log('    total                     ' + mib(ownCycPages + ownStr) + ' MiB = ' +
  (100 * (ownCycPages + ownStr) / retention).toFixed(1) + '% of what the user sees')
console.log(NL + 'in TOTAL working set, where the binary IS a floor:')
console.log('  idle ' + mib(M.presync) + ' MiB against a ' + mib(M.exe) +
  ' MiB executable; the image is file-backed and is')
console.log('  therefore NOT in the private column above. Both statements hold.')

ok(M.presyncPriv < M.presync * 0.5,
  'private idle (' + mib(M.presyncPriv) + ') is under half of total idle (' + mib(M.presync) +
  ') — the columns differ by the resident image and must never be conflated')
unmeas('whether what we can own (' + mib(ownCycPages + ownStr) + ' MiB) is less than the\n' +
  '              COMMITTED free space is UNMEASURED -- the same vacuity as above: the old\n' +
  '              check compared it against the ' + mib(M.crtFreeCeiling) + ' MiB CEILING.')

/* THE PLANT -- THE REPAIR HAS TO BE ABLE TO FAIL, AND IT HAS TO TELL THE TWO
 * ARMS APART. A check that reads the same whichever figure you feed it is
 * worth nothing, so the old assertion is re-run against BOTH: the retracted
 * 36.51 MiB ceiling, and the 1-4 MiB band the committed free space is
 * actually believed to lie in. If these arms ever stop differing, this
 * repair has decayed and the check below goes red. */
const arms = [
  ['ceiling 36.51 (the RETRACTED reading)', M.crtFreeCeiling],
  ['committed  1.00 (low end of real)',     1.00 * MiB],
  ['committed  4.00 (high end of real)',    4.00 * MiB],
]
console.log(NL + 'THE PLANT -- the old assertion, re-run against both arms:')
const verdicts = []
for (const [label, v] of arms) {
  const held = payload < v
  const g = M.settledWs - (sum + v)
  verdicts.push(held)
  console.log('  ' + label.padEnd(40) + 'payload<free: ' + (held ? 'HOLDS  ' : 'INVERTS') +
    '   itemisation gap ' + (100 * Math.abs(g) / M.settledWs).toFixed(1) + '%')
}
ok(verdicts.includes(true) && verdicts.includes(false),
  'the old `payload < free` assertion is SENSITIVE to which figure it is fed: it HOLDS\n' +
  '        against the ceiling and INVERTS inside the real committed band. That is the\n' +
  '        proof the old margin was an artifact of the ceiling, not a measured result.')

/* FLOOR: was `ran < 6`, now `ran < 4`, and the DROP IS CORRECT rather than a
 * regression to paper over. Three assertions became UNMEASURED (the closure
 * check, and the two `payload < ceiling` comparisons) because they were
 * VACUOUS -- a payload is always below a bound that overstates -- and one
 * real check (THE PLANT) was added: 6 - 3 + 1 = 4. This floor exists to
 * catch "the script did not run". IT DOES NOT ATTEST COVERAGE, and it must
 * never be raised merely to make a run pass. */
if (ran < 4) { console.log(NL + 'REFUSED: only ' + ran + ' checks ran'); process.exit(2) }
console.log(NL + 'unmeasured=' + unmeasured + '   (open items; NOT passes)')
console.log(NL + (fails ? 'PLATEAU FAILED (' + fails + ')' : 'PLATEAU OK'))
process.exit(fails ? 1 : 0)

/* RETRACTED COLUMN, 2026-10-11 -- `busy + free` IS NOT COMMITTED MEMORY
 *
 * THE LINES THIS BAND ANSWERS, at :86 and :101:
 *
 *     crtFree:      36.51 * MiB,
 *     ['CRT heap committed-FREE', M.crtFree,
 *
 * THIS IS THE SHARPEST CASE IN THE FRONT, because the row is SUMMED into
 * an itemisation of what the settled process holds. An unreported share of
 * those 36.51 MiB was already returned to the OS, so the itemisation's
 * total overstates what is paid and the `fragmentation` line at :163
 * overstates the recoverable part. The assertion at :125 (`payload <
 * M.crtFree`) compares a payload against a CEILING and can pass on a
 * margin that does not exist.
 *
 * `busy + free` is heap ADDRESS SPACE, not committed memory. The NT heap
 * decommits pages inside a free run without emitting a
 * PROCESS_HEAP_UNCOMMITTED_RANGE, so HeapWalk keeps reporting the whole block
 * and the `free` column mixes committed pages with pages already returned to
 * the OS. Demonstrated with a negative control (an arm that frees nothing
 * reads 100% MEM_COMMIT; three arms that free read 74.6% / 93.7% / 92.7%
 * MEM_RESERVE), and contradicted arithmetically in one run: an outside walk
 * resolves 21.312 MiB of private non-stack commit while this process's own
 * HeapWalk reports busy+free = 37.245 MiB.
 *
 * `busy` is unaffected -- it is live data. `uncommitted` is unaffected -- it
 * is reserved and not paid. The SUM is still a valid CEILING. Only its
 * reading as COMMIT is retracted.
 *
 * Full argument, negative control and inventory:
 * tests/perf/heapcensus/COMMITTED-FREE-RETRACTION.md
 *
 * This band audits ONE figure. EVERYTHING ELSE IN THIS FILE IS UNAUDITED BY
 * IT -- not thereby in force.
 *
 * IMPLEMENTED 2026-10-11, in this file, by the slice that wrote this note.
 * The band above DESCRIBED the defect; these are the changes that carry it
 * out, so a reader does not have to take the prose on trust:
 *   - `crtFree` is renamed `crtFreeCeiling`. The two lines quoted at :206
 *     and :207 are left spelled the OLD way on purpose -- they are this
 *     band's record of what it answered, not live code.
 *   - the ceiling is NO LONGER SUMMED into the itemisation; it is printed
 *     beside it as a bound.
 *   - the closure assertion and both `payload < ceiling` comparisons are
 *     now UNMEASURED, counted on their own `unmeasured=` output line, and
 *     they do NOT count as passes.
 *   - the `fragmentation` label is gone from the private-column breakdown.
 *   - THE PLANT re-runs the old assertion against the ceiling AND against
 *     the 1-4 MiB real band, and asserts the two DIFFER -- so the repair
 *     can fail, and a check that could not tell the arms apart would. */
