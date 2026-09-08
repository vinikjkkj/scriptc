/* census-read.mjs — turn an arrcensus report into the ANSWER, not a dump.
 *
 * The question the census was run to settle: is scr_arr_slice's 21.0% of
 * `send_group` a QUADRATIC or a million small copies? Those have opposite
 * fixes, so the reader has to state which shape the numbers are, and show
 * the evidence for it rather than asserting it.
 *
 *   node census-read.mjs <census.txt> [phase]
 *
 * Reports, overall and per phase: call count, elements moved, mean and max
 * copied length, the empty/whole split, the top histogram rows for both the
 * SOURCE length and the COPIED length, and the element-kind split (the ref
 * arm pays a retain per element through a function pointer; the scalar arms
 * could be one memcpy, and which one the workload takes decides what a fix
 * is even allowed to be).
 */
import { readFileSync } from 'node:fs'

const file = process.argv[2]
if (!file) { console.error('usage: census-read.mjs <census.txt> [phase]'); process.exit(2) }
const want = process.argv[3] ?? null
const text = readFileSync(file, 'utf8')

const slots = new Map()          // slot -> {calls,total,max}
const rows = new Map()           // slot -> Map(row -> count)
const phSlots = new Map()        // phase -> slot -> {calls,total}
const phRows = new Map()         // phase -> slot -> Map(row -> count)
const kinds = new Map()
const phKinds = new Map()
let whole = 0, empty = 0, planted = 0, phases = []
const phWhole = new Map(), phEmpty = new Map()

/* The histogram is EXACT for rows 0..255 and one row per power of two above
 * that. A row index >= 256 is a bucket, not a length, and must never be
 * printed as if it were a length -- that is how a "max 41" becomes a "max
 * 2^41" in a summary. */
const EXACT = 256
function rowLabel(i) {
  if (i < EXACT) return String(i)
  const b = i - EXACT
  return `2^${b}..2^${b + 1}-1`
}
function rowLow(i) { return i < EXACT ? i : 2 ** (i - EXACT) }

for (const line of text.split(/\r?\n/)) {
  let m
  if ((m = line.match(/^ARRCEN-ARM planted=(\d+)/))) planted = +m[1]
  else if ((m = line.match(/^ARRCEN-SLICE whole=(\d+) empty=(\d+)/))) { whole = +m[1]; empty = +m[2] }
  else if ((m = line.match(/^ARRCEN-SLOT (\S+) calls=(\d+) total=(-?\d+) max=(-?\d+)/)))
    slots.set(m[1], { calls: +m[2], total: +m[3], max: +m[4] })
  else if ((m = line.match(/^ARRCEN-ROW (\S+) (\d+) (\d+)/))) {
    if (!rows.has(m[1])) rows.set(m[1], new Map())
    rows.get(m[1]).set(+m[2], +m[3])
  } else if ((m = line.match(/^ARRCEN-KIND (\d+) calls=(\d+) elems=(\d+)/)))
    kinds.set(+m[1], { calls: +m[2], elems: +m[3] })
  else if ((m = line.match(/^ARRCEN-PH (\S+) slice\.whole=(\d+) slice\.empty=(\d+)/))) {
    phases.push(m[1]); phWhole.set(m[1], +m[2]); phEmpty.set(m[1], +m[3])
  } else if ((m = line.match(/^ARRCEN-PHSLOT (\S+) (\S+) calls=(\d+) total=(-?\d+)/))) {
    if (!phSlots.has(m[1])) phSlots.set(m[1], new Map())
    phSlots.get(m[1]).set(m[2], { calls: +m[3], total: +m[4] })
  } else if ((m = line.match(/^ARRCEN-PHROW (\S+) (\S+) (\d+) (\d+)/))) {
    if (!phRows.has(m[1])) phRows.set(m[1], new Map())
    const s = phRows.get(m[1])
    if (!s.has(m[2])) s.set(m[2], new Map())
    s.get(m[2]).set(+m[3], +m[4])
  } else if ((m = line.match(/^ARRCEN-PHKIND (\S+) (\d+) calls=(\d+) elems=(\d+)/))) {
    if (!phKinds.has(m[1])) phKinds.set(m[1], new Map())
    phKinds.get(m[1]).set(+m[2], { calls: +m[3], elems: +m[4] })
  }
}

const KINDNAME = { 0: 'f64/scalar', 1: 'i32', 2: 'bool', 3: 'str', 4: 'ref', 5: 'k5', 6: 'k6', 7: 'k7' }

function topRows(map, n = 8) {
  if (!map) return []
  return [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, n)
}

function describe(label, getSlot, getRows, getKinds, w, e) {
  const src = getSlot('slice-src'), nn = getSlot('slice-n')
  const js = getSlot('join-src'), jo = getSlot('join-outbytes')
  console.log(`\n=== ${label} ===`)
  if (!src || src.calls === 0) { console.log('  scr_arr_slice: 0 calls  (a real zero: the report exists)'); }
  else {
    const meanN = nn.total / nn.calls, meanSrc = src.total / src.calls
    console.log(`  scr_arr_slice  calls ${src.calls.toLocaleString()}`)
    console.log(`    elements copied   total ${nn.total.toLocaleString()}   mean ${meanN.toFixed(2)}   max ${nn.max ?? 'n/a'}`)
    console.log(`    source length     mean  ${meanSrc.toFixed(2)}   max ${src.max ?? 'n/a'}`)
    console.log(`    empty (n=0) ${e.toLocaleString()} (${(100 * e / src.calls).toFixed(1)}%)   whole (n=src) ${w.toLocaleString()} (${(100 * w / src.calls).toFixed(1)}%)`)
    const sr = topRows(getRows('slice-src')), nr = topRows(getRows('slice-n'))
    console.log(`    top SOURCE lengths : ${sr.map(([i, c]) => `${rowLabel(i)}x${c.toLocaleString()}`).join('  ')}`)
    console.log(`    top COPIED lengths : ${nr.map(([i, c]) => `${rowLabel(i)}x${c.toLocaleString()}`).join('  ')}`)
    const k = getKinds()
    if (k && k.size) console.log(`    element kinds      : ${[...k.entries()].map(([i, v]) => `${KINDNAME[i] ?? i}=${v.calls.toLocaleString()}`).join('  ')}`)
    /* THE DISCRIMINATOR, stated as evidence and not as a verdict. A quadratic
     * moves elements superlinearly in the source length: its mean copied
     * length tracks the mean source length and both are large. A million
     * small copies has a small mean copied length whatever the source is. */
    const bigSrc = [...(getRows('slice-src') ?? new Map()).entries()]
      .filter(([i]) => rowLow(i) >= 256).reduce((a, [, c]) => a + c, 0)
    console.log(`    calls whose SOURCE is >= 256 elements: ${bigSrc.toLocaleString()} (${(100 * bigSrc / src.calls).toFixed(2)}%)`)
    console.log(`    SHAPE: mean copy ${meanN.toFixed(1)} of mean source ${meanSrc.toFixed(1)}` +
      `  -> ${meanN < 32 && bigSrc / src.calls < 0.05 ? 'MANY SMALL COPIES' : meanN >= 0.5 * meanSrc && meanSrc >= 256 ? 'WHOLE-ARRAY COPIES OF LARGE ARRAYS' : 'MIXED — read the histogram'}`)
  }
  if (js && js.calls > 0) {
    console.log(`  scr_arr_join   calls ${js.calls.toLocaleString()}   elements ${js.total.toLocaleString()} (mean ${(js.total / js.calls).toFixed(2)})` +
      `   out bytes ${jo ? jo.total.toLocaleString() : '?'} (mean ${jo ? (jo.total / jo.calls).toFixed(1) : '?'})`)
    console.log(`    top join SOURCE lengths: ${topRows(getRows('join-src')).map(([i, c]) => `${rowLabel(i)}x${c.toLocaleString()}`).join('  ')}`)
  } else console.log('  scr_arr_join   0 calls')
}

console.log(`census: ${file}`)
console.log(`ARM planted=${planted}` + (planted > 0
  ? '   *** ARMED RUN: planted rows are inflated by the TU count; do not read these as real counts ***'
  : '   (unarmed — these are the real counts)'))
console.log(`phases seen: ${phases.length ? phases.join(', ') : 'NONE (no phase markers in this binary)'}`)

describe('WHOLE PROGRAM', s => slots.get(s), s => rows.get(s), () => kinds, whole, empty)

for (const p of phases) {
  if (want && p !== want) continue
  describe(`PHASE ${p}`,
    s => phSlots.get(p)?.get(s),
    s => phRows.get(p)?.get(s),
    () => phKinds.get(p),
    phWhole.get(p) ?? 0, phEmpty.get(p) ?? 0)
}
