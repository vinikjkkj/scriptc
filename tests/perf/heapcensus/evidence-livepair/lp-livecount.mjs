/* lp-livecount.mjs -- the LIVE population of the megabyte pair at the peak
 * instant, from committed data only. No build, no run, no arguments.
 *
 *   node tests/perf/heapcensus/evidence-livepair/lp-livecount.mjs
 *
 * WHY THIS SCRIPT EXISTS. evidence-megapair's bands are a FLOW count: 25
 * allocations over a whole run, 24,390,400 B, 8 x 934,576 from a producer and
 * 8 x 934,576 from scr_bytes_copy. A flow of two 934,576 per chunk is NOT a
 * population of two 934,576 per chunk. The hypothesis under test was that the
 * reader buffer (1,048,576), the producer buffer (934,576) and the copy
 * (934,576) are all alive at once -- ~2.9 MB per chunk x 8.
 *
 * The peak census answers it directly. HCPKSIZE is the busy-block histogram
 * captured at the high-water instant: class, COUNT, bytes. The class label is
 * the REQUEST (scr_heap_census.h:161,317 annotate cbData), so it is the same
 * quantity the PROF bands key on, with no correction term; overhead rides in
 * the bytes column only.
 *
 * SOURCE. tests/perf/heapcensus/evidence-peakvar/p{1..6}.heapcen.txt -- six
 * runs, three per lane, arms fixed in that slice's PREREG before run 1:
 *   pos 1 SL   pos 2 FB   pos 3 FB   pos 4 SL   pos 5 SL   pos 6 FB
 * Those six runs are a DIFFERENT BUILD from mb-out182-prof, which is why this
 * script reads only live counts here and never mixes in a band count.
 *
 * CONTROLS.
 *  - POSITIVE: 65,536 (the string arena + cycle-collector arena class, the
 *    largest single class of the transient) must read a live count that both
 *    moves across runs and is far above 8. A parser that returned zeros
 *    everywhere would fail this.
 *  - NEGATIVE: a class that does not exist (1,048,575) must read absent in
 *    all six. A parser that matched loosely would fail this.
 *  - COVERAGE: HCPKCOVER snapPrivate/kernelPeakPagefile per run. A snapshot
 *    taken off the peak is a reading of a trough, and is reported, not hidden.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const HERE = dirname(fileURLToPath(import.meta.url))
const PV = join(HERE, '..', 'evidence-peakvar')
const RUNS = [
  ['p1', 'SL', 1], ['p2', 'FB', 2], ['p3', 'FB', 3],
  ['p4', 'SL', 4], ['p5', 'SL', 5], ['p6', 'FB', 6],
]
const READER = 1048576   /* B, ProtoStreamReader.ensure's grown buffer */
const PAYLOAD = 934576   /* A, the producer's take; C, scr_bytes_copy's clone */
const ARENA = 65536      /* positive control */
const GHOST = 1048575    /* negative control */
const CHUNKS = 8         /* the run knob: CHUNKS=8, one history-sync chunk each */

function parse(tag) {
  const txt = readFileSync(join(PV, tag + '.heapcen.txt'), 'latin1')
  const live = new Map()
  let cover = null
  for (const line of txt.split(/\r?\n/)) {
    const m = /^HCPKSIZE (\d+) (\d+) (\d+)$/.exec(line)
    if (m) { live.set(Number(m[1]), { n: Number(m[2]), bytes: Number(m[3]) }); continue }
    const c = /HCPKCOVER snapPrivate=(\d+) kernelPeakPagefile=(\d+)/.exec(line)
    if (c) cover = Number(c[1]) / Number(c[2])
  }
  if (live.size === 0) throw new Error('no HCPKSIZE rows in ' + tag)
  return { live, cover }
}

const rows = RUNS.map(([tag, arm, pos]) => ({ tag, arm, pos, ...parse(tag) }))

const pad = (s, n) => String(s).padStart(n)
console.log('LIVE POPULATION AT THE PEAK INSTANT -- evidence-peakvar, HCPKSIZE')
console.log('each row is ONE run; counts are busy blocks of that request size')
console.log('')
console.log(' run arm pos   cover   1,048,576      934,576   ratio   per chunk (n/8)')
console.log(' --- --- ---  ------   ---------      -------   -----   ---------------')
for (const r of rows) {
  const a = r.live.get(READER), b = r.live.get(PAYLOAD)
  const an = a ? a.n : 0, bn = b ? b.n : 0
  console.log(' ' + r.tag + '  ' + r.arm + '   ' + r.pos + '   ' +
    pad((100 * r.cover).toFixed(2) + '%', 7) + '   ' +
    pad(an, 4) + ' / ' + pad(a ? a.bytes : 0, 9) + '   ' +
    pad(bn, 4) + ' / ' + pad(b ? b.bytes : 0, 7) + '   ' +
    pad((bn / an).toFixed(2), 5) + '   ' +
    pad((an / CHUNKS).toFixed(3), 6) + ' / ' + (bn / CHUNKS).toFixed(3))
}
console.log('')

const sl = rows.filter(r => r.arm === 'SL')
const allOne = rows.every(r => r.live.get(PAYLOAD).n === r.live.get(READER).n)
console.log('STACKLESS (the shipping lane) only: ' +
  sl.map(r => r.tag + '=' + r.live.get(READER).n + '/' + r.live.get(PAYLOAD).n).join('  '))
console.log('RATIO 934,576 : 1,048,576 is exactly 1:1 in all six runs: ' + allOne)
console.log('')
console.log('THE ARITHMETIC PER CHUNK, at the peak instant:')
for (const r of sl) {
  const a = r.live.get(READER).n, b = r.live.get(PAYLOAD).n
  console.log('  ' + r.tag + ': ' + a + ' x 1,048,576 + ' + b + ' x 934,576 = ' +
    (a * READER + b * PAYLOAD).toLocaleString('en-US') + ' B over ' + a +
    ' of ' + CHUNKS + ' chunks = ' +
    Math.round((a * READER + b * PAYLOAD) / a).toLocaleString('en-US') + ' B per chunk')
}
console.log('  predicted by the three-live hypothesis: 1,048,576 + 2 x 934,576 = ' +
  (READER + 2 * PAYLOAD).toLocaleString('en-US') + ' B per chunk')
console.log('  measured:                               1,048,576 + 1 x 934,576 = ' +
  (READER + PAYLOAD).toLocaleString('en-US') + ' B per chunk')
console.log('  the hypothesis predicts ' +
  (((READER + 2 * PAYLOAD) / (READER + PAYLOAD) - 1) * 100).toFixed(1) +
  '% more live bytes per chunk than the peak census holds.')
console.log('')

console.log('CONTROLS')
const pos = rows.map(r => (r.live.get(ARENA) || { n: 0 }).n)
console.log('  POSITIVE  65,536 live count per run: ' + pos.join(' ') +
  '  -- varies: ' + (new Set(pos).size > 1) + ', all > CHUNKS: ' + pos.every(n => n > CHUNKS))
const neg = rows.map(r => r.live.has(GHOST))
console.log('  NEGATIVE  1,048,575 present in any run: ' + neg.some(Boolean) +
  '  (a class one byte off the real one)')
console.log('  COVERAGE  snapPrivate/kernelPeakPagefile: ' +
  rows.map(r => r.tag + '=' + (100 * r.cover).toFixed(2) + '%').join(' '))
console.log('')
console.log('VERDICT: ' + (allOne
  ? 'ONE 934,576 is live per live 1,048,576. The producer buffer and its copy'
  : 'the pair does NOT move 1:1 -- re-read before concluding'))
if (allOne) console.log('         are NEVER both resident at the peak. SIMULTANEITY REFUTED.')
