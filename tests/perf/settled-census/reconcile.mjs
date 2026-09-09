/* reconcile.mjs - the settled zapo process, itemised, from committed evidence.
 *
 *   node tests/perf/settled-census/reconcile.mjs [--dir <evidence>]
 *
 * WHY THIS IS AN ARTIFACT AND NOT A PARAGRAPH. Every unverifiable scalar
 * this project has quoted has come back to bite it. The most recent was
 * "2,794 bytes per boxed record", which was repeated in briefs and to the
 * user for days and exists nowhere in the tree at any revision -- no
 * README, no comment, no commit message, no test -- so it could never be
 * checked and was eventually simply withdrawn. The numbers below are the
 * load-bearing ones for the whole retention objective, so they ship as
 * evidence plus a checker that re-derives them, and anyone can re-run it.
 *
 * THE EVIDENCE. evidence/ holds one complete run from block/arenafree,
 * arm `n1`: the post-giveback shipping arm, documented workload
 * (CHUNKS=8 CONVS=400 MSGS=6 TEXTLEN=300 ROUNDS=1 IDLE_S=60), driven by
 * tests/perf/zapo-rest/harness/memrig.mts. Four files, 37 KB total:
 * cycstat (both arenas' chunk counts), heapcen (every heap walked, exact
 * busy-size histogram), phases.csv and rss.csv (the kernel-side series).
 *
 * PROVENANCE, STATED BECAUSE IT LIMITS THE CLAIM. This run is from the
 * 09-06 arenafree work, NOT from e6f48fb2f, and its binary is the 1.6.2-era
 * arm. The STRUCTURAL conclusion -- fragmentation dominates, both arenas
 * together are ~13% of the settled process -- is what this file asserts,
 * and it is not sensitive to that. The exact MiB on the current LLVM-tier
 * 1.8.2 binary is owed and is not claimed here.
 *
 * THE THREE-WAY RECONCILIATION is the reason to believe any of it. Two
 * instruments that share no code agree on the arena total:
 *   cycstat   counts chunks the allocator took and released: held=161
 *             cycle + 55 string = 216.
 *   heapcen   walks the OS heap and histograms BUSY blocks by exact size,
 *             knowing nothing about arenas: 218 blocks of exactly 65,536 B.
 * 99.1% agreement, and the 161 independently matches block/pagereturn's
 * own count. A single instrument agreeing with itself proves nothing; two
 * that cannot see each other agreeing is evidence.
 *
 * THE REGISTERED PREDICTION. Written down BEFORE the free-side histogram
 * exists, so that reading it later is a test and not a story:
 *
 *   A boxed record's entries array is realloc(cap * sizeof(ScrDynEntry)).
 *   ScrDynEntry is char* + uint32 + uint32 + ScrDyn* = 24 bytes exactly.
 *   cap starts at SCR_DYN_OBJ_FIRST_CAP = 1 and DOUBLES (scr_json.c, the
 *   scr_dyn_obj_set grow path). So entries arrays can only ever have sizes
 *   from the series 24 * 2^n:
 *
 *       24  48  96  192  384  768  1536  3072  6144  12288  24576 ...
 *
 *   That is 3 * 2^n. It is NOT a power of two, which is what makes it a
 *   usable signature: an 88-90 member app-state record rounds cap to 128
 *   and lands on exactly 3,072 bytes. Array item buffers are the OTHER
 *   series, cap * sizeof(ScrDyn*) = 8 * 2^n, i.e. powers of two, and do
 *   not collide with it above 24.
 *
 *   Both series bypass the arenas entirely: the cycle arena serves only
 *   scr_cyc_alloc blocks, and these are plain realloc, so every entries
 *   array is a CRT-heap block whatever its size.
 *
 *   The small end (24, 48, 96, 192) is deliberately NOT diagnostic: many
 *   populations land there and a peak proves nothing.
 *
 *   AND A PEAK AT 3*2^n IS NOT EVIDENCE OF BOXING ON THIS WORKLOAD. This
 *   is registered BEFORE the reading precisely so the result cannot later
 *   be read as a confirmation. The ladder is real arithmetic, and two
 *   blocks derived it independently -- but the emitted code says it is not
 *   on the history-sync path at all:
 *
 *     scr_dyn_obj_set appears ZERO times in the whole binary's emitted
 *     code; a notification boxes four SCALARS, not a record; there is no
 *     88-90 member record anywhere in the tree (the largest generated
 *     proto types are 108, 81, 72 and 63); and the sync-path records are
 *     3-12 fields, which are arena-carved and never reach malloc.
 *
 *   So holes at 3*2^n come from somewhere else -- JSON, app-state, the
 *   island path -- and finding them CONFIRMS NOTHING about boxing during a
 *   sync. The busy side already pointed this way: the whole series sums to
 *   1.52 MiB of 40.64 MiB, with the 3,072 class at twelve blocks.
 *
 * THE SHARPER PREDICTION, and it is neither this block's nor the
 * coordinator's -- it comes from reading scr_string.c's allocation bands.
 *
 *   scr_str_alloc serves from the pool or the string arena only while
 *   cap <= 243, and scr_str_release keeps a single spare only for
 *   cap >= 512. The band 244..511 is therefore raw malloc/free with NO
 *   recycling of any kind: every string in it is a fresh malloc and its
 *   death is a fresh hole.
 *
 *   The rig's message bodies are 'x'.repeat(300) plus a short suffix, so
 *   lengths are 309-311, and the request is 8*ceil((cap+13)/8):
 *       309 -> 8*ceil(322/8) = 328
 *       311 -> 8*ceil(324/8) = 328
 *   All three land on the same request.
 *
 *   PREDICTION: a mode at 328 B, population near 19,200 per round
 *   (CHUNKS 8 * CONVS 400 * MSGS 6), ABSENT from a CHUNKS=0 control.
 *
 *   REFUTED IF: no 328 mode; or a 328 mode that survives CHUNKS=0 (then it
 *   is not the message bodies); or a population off by more than ~2x from
 *   19,200 per round with no coalescing account of the difference.
 *
 *   THE COALESCING CAVEAT, registered rather than discovered afterwards:
 *   the NT heap merges a freed block with adjacent free neighbours, so the
 *   mode may appear at small integer MULTIPLES of 328 rather than at 328
 *   itself. The observed 710 B mean free-hole size is consistent with
 *   roughly two coalesced 328s plus per-block overhead. Multiples are
 *   therefore an expected form of the same prediction -- but that is
 *   stated NOW, so that reading 656 or 984 later is a confirmation of
 *   something written down and not a fit invented to rescue it.
 *
 *   A NEAR-COLLISION TO NOT FALL INTO. 4 * 328 = 1312, and the settled
 *   busy side has a real population at 1328 B (4,097 blocks, 5.31 MiB).
 *   Those are DIFFERENT sizes, 16 bytes apart, and an exact-size table is
 *   what keeps them apart -- but a reader rounding or bucketing would
 *   merge them and read a coalesced-body mode that is not there. 1328 is
 *   also not a multiple of 24, so it is not an entries array either; it is
 *   a third population and it is unattributed.
 *
 * THE THREE LADDERS ARE ARITHMETICALLY SEPARABLE, which is what lets this
 * histogram attribute rather than merely count:
 *
 *   scr_arr_grow        cap * 8, doubling from 4   exact powers of two
 *   scr_dyn_obj_put_k   cap * 24, doubling from 1  3 * 2^n
 *   scr_str_alloc       8*ceil((cap+13)/8)         dense multiples of 8
 *
 * SIZES ARE COMPARED ON cbData, never cbData + cbOverhead. Every ladder
 * above is a REQUEST size; folding the heap's own per-block header into
 * the key would shift all three by an amount that varies with the bucket
 * and make them incomparable. scr_heap_census.h keys HCFREE and HCSIZE on
 * cbData for exactly this reason.
 *
 * ONE THING THAT EXPLAINS NOTHING HERE, recorded so no one spends a window
 * on it: cachedNctSalt does NOT pin a decompressed chunk on this workload.
 * The rig never sends nctSalt, the field is optional, protobuf omits it,
 * and the assignment never runs. It contributes zero to the 105.14 MiB,
 * zero to the live total and zero to this histogram. The defect is real
 * against real WhatsApp traffic and must not be used to explain one
 * measured byte of this run.
 *
 * THE DISCRIMINATOR, checked here on the busy side because it can be. The
 * two largest non-chunk busy populations are 4,376 B (2,555 blocks) and
 * 1,328 B (4,097 blocks). Neither is a multiple of 24, so NEITHER can be
 * an entries array -- 4376/24 = 182.33, 1328/24 = 55.33. That ambiguity is
 * resolved before the measurement rather than after it. (4,376 is almost
 * certainly SQLite's page cache: 4096 + 280 of pcache overhead.)
 */
import { readFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const argAt = (n) => { const i = process.argv.indexOf(n); return i >= 0 ? process.argv[i + 1] : null }
const DIR = argAt('--dir') ?? join(HERE, 'evidence')
const MiB = 1024 * 1024

let fails = 0
const ok = (cond, msg) => { console.log((cond ? '  PASS  ' : '  FAIL  ') + msg); if (!cond) fails++ }
const mib = (b) => (b / MiB).toFixed(2)

/* ---- parse ---------------------------------------------------------- */

function readCycstat(text) {
  const out = {}
  for (const line of text.split(/\r?\n/)) {
    const cyc = line.match(/arena chunks=(\d+).*?held=(\d+)/)
    if (cyc) { out.cycChunks = +cyc[1]; out.cycHeld = +cyc[2] }
    const str = line.match(/strarena chunks=(\d+)/)
    if (str) out.strChunks = +str[1]
    const give = line.match(/strarena .*listgive=(\d+)/)
    if (give) out.strGive = +give[1]
  }
  return out
}

function readHeapcen(text) {
  const out = { sizes: new Map(), free: new Map(), heaps: [] }
  for (const line of text.split(/\r?\n/)) {
    const h = line.match(/heap (\d+) \w+( CRT)? busy=(\d+) busyBlocks=(\d+) free=(\d+) freeBlocks=(\d+) uncommitted=(\d+)/)
    if (h) out.heaps.push({ crt: !!h[2], busy: +h[3], nbusy: +h[4], free: +h[5], nfree: +h[6], unc: +h[7] })
    const s = line.match(/^HCSIZE (\d+) (\d+) (\d+)/)
    if (s) out.sizes.set(+s[1], { n: +s[2], bytes: +s[3] })
    const f = line.match(/^HCFREE (\d+) (\d+) (\d+)/)
    if (f) out.free.set(+f[1], { n: +f[2], bytes: +f[3] })
    const p = line.match(/HCPAGE runs=(\d+) runBytes=(\d+) runMax=(\d+) wholePages=(\d+) pageBytes=(\d+)/)
    if (p) out.page = { runs: +p[1], runBytes: +p[2], runMax: +p[3], pages: +p[4], pageBytes: +p[5] }
  }
  return out
}

function settledWs(phasesText, rssText) {
  const ph = new Map()
  for (const l of phasesText.split(/\r?\n/).slice(1)) {
    const i = l.indexOf(',')
    if (i > 0 && !ph.has(l.slice(i + 1))) ph.set(l.slice(i + 1), +l.slice(0, i))
  }
  const rows = rssText.split(/\r?\n/).slice(1).filter(Boolean).map((l) => l.split(','))
  const at = (ms) => {
    let best = null, bd = Infinity
    for (const r of rows) { const d = Math.abs(+r[0] - ms); if (d < bd) { bd = d; best = r } }
    return best ? +best[1] : 0
  }
  return {
    presync: ph.has('PRESYNC-BASELINE') ? at(ph.get('PRESYNC-BASELINE')) : 0,
    settled: ph.has('IDLE-60s') ? at(ph.get('IDLE-60s')) : 0,
    peak: Math.max(...rows.map((r) => +r[1])),
  }
}

/* ---- the checker's own control --------------------------------------- */
/* A reconciliation that only ever agrees is worth nothing. Feed the parser
 * a line it MUST reject and a line it MUST accept, so a regex that has
 * rotted cannot report a clean reconciliation of nothing. */
{
  const good = readHeapcen('HCSIZE 65536 218 14290352\n[heapcen] heap 0 X CRT busy=1 busyBlocks=2 free=3 freeBlocks=4 uncommitted=5 regions=6')
  const bad = readHeapcen('HCSIZE not-a-number 218\nnothing here')
  const c1 = good.sizes.get(65536)?.n === 218
  const c2 = good.heaps.length === 1 && good.heaps[0].crt === true
  const c3 = bad.sizes.size === 0 && bad.heaps.length === 0
  console.log('control: parser accepts a good line, rejects a bad one, sees CRT: ' +
    (c1 && c2 && c3 ? 'OK' : 'INSTRUMENT DEAD'))
  if (!(c1 && c2 && c3)) process.exit(2)
}

/* ---- load ------------------------------------------------------------ */

const need = ['n1.cycstat.txt', 'n1.heapcen.txt', 'n1.phases.csv', 'n1.rss.csv']
for (const f of need) if (!existsSync(join(DIR, f))) { console.error('missing evidence: ' + f); process.exit(2) }
const cs = readCycstat(readFileSync(join(DIR, 'n1.cycstat.txt'), 'utf8'))
const hc = readHeapcen(readFileSync(join(DIR, 'n1.heapcen.txt'), 'utf8'))
const ws = settledWs(readFileSync(join(DIR, 'n1.phases.csv'), 'utf8'), readFileSync(join(DIR, 'n1.rss.csv'), 'utf8'))
const crt = hc.heaps.find((h) => h.crt) ?? hc.heaps[0]

console.log('\n== the settled process, arm n1 ==')
console.log('  presync baseline   ' + mib(ws.presync) + ' MiB working set')
console.log('  peak               ' + mib(ws.peak) + ' MiB')
console.log('  settled (+60s)     ' + mib(ws.settled) + ' MiB')
console.log('  retention          ' + mib(ws.settled - ws.presync) + ' MiB above baseline')
console.log('\n  CRT heap busy      ' + mib(crt.busy) + ' MiB in ' + crt.nbusy + ' blocks')
console.log('  CRT heap FREE      ' + mib(crt.free) + ' MiB in ' + crt.nfree +
  ' blocks, mean ' + Math.round(crt.free / crt.nfree) + ' B')
console.log('  CRT uncommitted    ' + mib(crt.unc) + ' MiB')

console.log('\n== [1] the three-way arena reconciliation ==')
const chunkBlocks = hc.sizes.get(65536)?.n ?? 0
const predicted = cs.cycHeld + cs.strChunks
console.log('  cycstat: cycle held=' + cs.cycHeld + ' + string=' + cs.strChunks + ' = ' + predicted + ' chunks')
console.log('  heapcen: ' + chunkBlocks + ' busy blocks of exactly 65,536 B (knows nothing of arenas)')
ok(chunkBlocks >= predicted, 'the heap sees at least as many 64 KiB blocks as the arenas hold')
ok(chunkBlocks - predicted <= 5,
  'they agree to within 5 blocks (' + (chunkBlocks - predicted) + ' unattributed, 64 KiB mallocs from elsewhere)')

console.log('\n== [2] both arenas are a small share of the settled process ==')
const arenaBytes = predicted * 65536
console.log('  arenas             ' + mib(arenaBytes) + ' MiB  (cycle ' + mib(cs.cycHeld * 65536) +
  ' + string ' + mib(cs.strChunks * 65536) + ')')
ok(arenaBytes / ws.settled < 0.20,
  'arenas are under 20% of settled working set (' + (100 * arenaBytes / ws.settled).toFixed(1) + '%)')
ok(crt.free > crt.busy,
  'the heap holds MORE committed-free than busy (' + mib(crt.free) + ' vs ' + mib(crt.busy) + ' MiB)')
ok(Math.abs(crt.free - (ws.settled - ws.presync)) / (ws.settled - ws.presync) < 0.15,
  'committed-free space accounts for the retention to within 15% (' + mib(crt.free) +
  ' free vs ' + mib(ws.settled - ws.presync) + ' retained)')

console.log('\n== [3] the string arena, which cannot free a chunk at all ==')
console.log('  string chunks ' + cs.strChunks + ' = ' + mib(cs.strChunks * 65536) + ' MiB, listgive=' + cs.strGive)
ok(cs.strGive === 0, 'scr_str_ar_give is never reached: listgive=0, so nothing is ever recycled')
ok(cs.strChunks * 65536 < 0.06 * ws.settled,
  'and it is under 6% of settled — a real defect, NOT the retention (' +
  (100 * cs.strChunks * 65536 / ws.settled).toFixed(1) + '%)')

console.log('\n== [4] the entries-array prediction, registered before the free side exists ==')
const SERIES = [1, 2, 4, 8, 16, 32, 64, 128, 256, 512].map((c) => c * 24)
const DIAG = [768, 1536, 3072, 6144, 12288]
console.log('  entries arrays can only be 24*2^n: ' + SERIES.join(' '))
console.log('  diagnostic sizes (nothing else observed lands there): ' + DIAG.join(' '))
let seriesBytes = 0
for (const s of SERIES) { const r = hc.sizes.get(s); if (r) seriesBytes += r.bytes }
console.log('  busy bytes on the whole series: ' + mib(seriesBytes) + ' MiB of ' + mib(crt.busy) + ' MiB busy')
for (const s of [4376, 1328]) {
  const r = hc.sizes.get(s)
  ok(s % 24 !== 0,
    'the ' + s + ' B population (' + (r ? r.n : 0) + ' blocks, ' + mib(r ? r.bytes : 0) +
    ' MiB) is NOT a multiple of 24, so it cannot be an entries array')
}
/* The message-body band. 244..511 is raw malloc/free with no recycling,
 * and the rig's bodies all request 328 B. Multiples are an expected form
 * of the same prediction because the NT heap coalesces adjacent frees. */
const STRMODE = 328
const MULT = [1, 2, 3, 4].map((k) => k * STRMODE)
const PER_ROUND = 8 * 400 * 6

console.log('\n== [5] the message-body band: 244..511 is raw malloc/free, no recycling ==')
console.log('  predicted mode ' + STRMODE + ' B (bodies are 309-311 chars; 8*ceil((cap+13)/8))')
console.log('  predicted population ~' + PER_ROUND + ' per round, ABSENT under CHUNKS=0')
console.log('  coalescing may move it to multiples: ' + MULT.join(' '))

if (hc.free.size === 0) {
  console.log('\n  FREE-SIDE HISTOGRAM ABSENT in this evidence (it predates HCFREE).')
  console.log('  -> [4] and [5] are REGISTERED and UNTESTED. Re-run with --dir pointed at')
  console.log('     a report from a binary carrying the current heapcensus.')
} else {
  let allB = 0, allN = 0
  for (const [, r] of hc.free) { allB += r.bytes; allN += r.n }

  let diagN = 0, diagB = 0
  for (const [sz, r] of hc.free) if (DIAG.includes(sz)) { diagN += r.n; diagB += r.bytes }
  const dshare = 100 * diagB / allB
  console.log('\n  [4] holes at DIAGNOSTIC 3*2^n sizes: ' + diagN + ' holes, ' +
    mib(diagB) + ' MiB = ' + dshare.toFixed(1) + '% of free bytes')
  console.log(dshare >= 20
    ? '      -> a large 3*2^n population EXISTS. Note it is NOT evidence of boxing on\n' +
      '         the sync path: scr_dyn_obj_set is emitted zero times. Attribute it to\n' +
      '         JSON / app-state / the island path before claiming anything.'
    : '      -> entries arrays are not a major component; consistent with the emitted\n' +
      '         code, which puts that ladder off the sync path entirely.')

  /* Rank the top holes so the mode is read off the data, not assumed. */
  const top = [...hc.free.entries()].sort((a, b) => b[1].bytes - a[1].bytes).slice(0, 8)
  console.log('\n  top free-hole sizes by bytes:')
  for (const [sz, r] of top)
    console.log('      ' + String(sz).padStart(8) + ' B  ' + String(r.n).padStart(9) +
      ' holes  ' + mib(r.bytes).padStart(8) + ' MiB' +
      (MULT.includes(sz) ? '   <- ' + (sz / STRMODE) + 'x the predicted body mode' : ''))

  let mN = 0, mB = 0
  for (const [sz, r] of hc.free) if (MULT.includes(sz)) { mN += r.n; mB += r.bytes }
  console.log('\n  [5] holes at ' + STRMODE + ' B or a small multiple: ' + mN + ' holes, ' +
    mib(mB) + ' MiB = ' + (100 * mB / allB).toFixed(1) + '% of free bytes')
  const exact = hc.free.get(STRMODE)
  console.log('      exactly ' + STRMODE + ' B: ' + (exact ? exact.n : 0) + ' holes' +
    ' (predicted ~' + PER_ROUND + ' per round)')
  console.log(mN >= PER_ROUND / 2
    ? '      -> CONSISTENT with the prediction. It is not confirmed until a CHUNKS=0\n' +
      '         control shows the mode ABSENT; without that control it is a coincidence\n' +
      '         of size, since 328 is an unremarkable number for a heap to hold.'
    : '      -> REFUTED on this evidence: the band is not where the free space is.')

  if (hc.page)
    console.log('\n  page ceiling: ' + hc.page.pages + ' whole pages = ' + mib(hc.page.pageBytes) +
      ' MiB of ' + mib(crt.free) + ' MiB free (' +
      (100 * hc.page.pageBytes / crt.free).toFixed(2) + '%), longest run ' +
      hc.page.runMax + ' B')
}

console.log(fails ? '\nRECONCILE FAILED (' + fails + ')' : '\nRECONCILE OK')
process.exit(fails ? 1 : 0)
