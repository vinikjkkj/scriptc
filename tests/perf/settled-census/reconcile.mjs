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
 * WHICH ARM, AND IT MUST BE NAMED EVERY TIME. All figures here are the
 * UNSERIALISED arm -- the shipping dispatch, not the env-gated
 * history-sync serialisation experiment. That experiment measured -62%
 * peak working set and -75% peak commit on this workload and is FORBIDDEN
 * TO SHIP (it patches zapo, which the user has ruled out). It therefore
 * bounds what any runtime-side change can claim: a fix here is competing
 * for the residue that discipline would already have removed, and a figure
 * that does not name its arm will eventually be compared against one that
 * had it. Every number in this file is unserialised.
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
 *   IS A PEAK AT 3*2^n EVIDENCE OF BOXING? AMBIGUOUS -- and the way that
 *   was established is the lesson, not the answer.
 *
 *   This file previously said the ladder was EXCLUDED, on the grounds that
 *   scr_dyn_obj_set appears zero times in the emitted code. That zero was
 *   a grep of the wrong symbol. Counted on the 1.8.2 .c artifact:
 *
 *       scr_dyn_obj_set(              3
 *       scr_dyn_obj_set_lit(     11,512
 *       scr_dyn_obj_set_present_lit(  4,508
 *
 *   All three route through scr_dyn_obj_put_k into the same v.obj.entries
 *   array with the same cap*24 doubling, and the record converter always
 *   calls the _lit form because the key is a compiler-emitted literal. All
 *   16,023 sites are inside sc_td_ converters -- the crossing is the only
 *   writer of that array. So the ladder IS on the sync path's emitted
 *   code, and holes at 3*2^n are consistent with boxing again.
 *
 *   WHAT DISCRIMINATES IS THE CHUNKS=0 CONTROL, NOT A SYMBOL COUNT.
 *   Emitted call sites are not executions: a binary can carry 16,023 of
 *   them and run four per notification. Only a run with no history
 *   delivered can say which sizes belong to the sync.
 *
 *   Likewise corrected: 88-90 member records DO exist in 1.8.2 --
 *   record:r981 has 90 members -- as APP-STATE MUTATION shapes rather
 *   than generated proto types. "The largest generated proto types are
 *   108, 81, 72 and 63" and "a 90-member record exists" are both true;
 *   "there is no 88-90 member record in the tree" was not.
 *
 *   THE SMALL END (24, 48, 96, 192) REMAINS NOT DIAGNOSTIC whatever the
 *   above: many populations land there and a peak proves nothing.
 *
 * A ZERO IS A CLAIM ABOUT THE PATTERN UNTIL A POSITIVE CONTROL SAYS
 * OTHERWISE. Three greps in this investigation have now returned zero and
 * been wrong: this file's scr_dyn_obj_set count, which missed two _lit
 * variants carrying 16,023 of the 16,023 real sites; an attribution sweep
 * whose pattern required `static` and so matched nothing; and a
 * machine-path scan that MSYS had rewritten before the matcher saw it.
 * Every zero quoted here is now expected to name the pattern that
 * produced it and to have been run against a case that must match.
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
 *   >>> REFUTED, on the second of those criteria, before this instrument
 *   ran. A profiler difference over the burst puts the uncovered string
 *   band at 301,903 calls with a mean of 312 bytes -- not 328 -- and
 *   301,903 against a predicted 19,200 per round is 15.7x off, far outside
 *   the ~2x the criterion allowed. The band is 89.71 MiB, 5.2% of the
 *   burst. The prediction and its refutation are both kept here rather
 *   than the prediction being quietly replaced: the sequence is the
 *   record, and a file that only ever shows its surviving guesses is not
 *   evidence of anything.
 *
 *   What survives is the reason the band was interesting -- 244..511 is
 *   still raw malloc/free with no recycling -- and the arithmetic that
 *   distinguishes 312 from 328 from 1328 at all, which is why HCFREE
 *   compares on cbData with no binning.
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
 * WHAT THE BURST ACTUALLY ALLOCATES, measured by a profiler difference
 * over the sync and registered here BEFORE this histogram is read. It
 * changes what the free side should be expected to look like.
 *
 *   the whole burst        1,721.70 MiB allocated, 21.00 MiB kept = 1.22%
 *   scr_array.c:172        1,285.01 MiB over 1,350,463 calls, mean 998 B,
 *                          survival 0.00% -- 74.6% of the whole burst
 *   scr_json.c:1636        241,519 reallocs, 20.24 MiB during the burst
 *                          (the dyn entries array: 25,665 -> 267,184)
 *   uncovered string band  89.71 MiB over 301,903 calls, mean 312 B, 5.2%
 *
 * So the residue this histogram is looking at is dominated by ~1.35M
 * ARRAY reallocs at a mean near 1 KB, freed at 0.00% survival -- not by a
 * string mode and not by entries arrays. An allocation with 0.00% survival
 * contributes nothing to the BUSY side and everything to the free side,
 * which is exactly the population HCFREE exists to see and the busy-side
 * histogram could never have shown.
 *
 * The 3*2^n ladder is now on the sync path by MEASUREMENT rather than by
 * symbol count: scr_json.c:1636 is the entries realloc and it moves by
 * 241,519 calls across the burst. Holes at those sizes are real. What
 * still has to separate them from everything else is the CHUNKS=0
 * control, because "real during a sync" and "still there when settled"
 * are different claims and only the control tests the second.
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
  const out = { arenaOff: false, strArenaOff: false }
  for (const line of text.split(/\r?\n/)) {
    const cyc = line.match(/arena chunks=(\d+).*?held=(\d+)/)
    if (cyc) { out.cycChunks = +cyc[1]; out.cycHeld = +cyc[2] }
    const carv = line.match(/arena .*carved=(\d+)/)
    if (carv && !line.includes("strarena")) out.cycCarved = +carv[1]
    const str = line.match(/strarena chunks=(\d+)/)
    if (str) out.strChunks = +str[1]
    const scarv = line.match(/strarena .*carved=(\d+)/)
    if (scarv) out.strCarved = +scarv[1]
    const give = line.match(/strarena .*listgive=(\d+)/)
    if (give) out.strGive = +give[1]
    /* cycstat's own refusal lines. They are the difference between "the
     * arena found nothing" and "the arena was not running", and only one
     * of those makes the block-size histogram mean what this file says. */
    if (line.includes("ARENA NEVER CARVED") && !line.includes("STRING")) out.arenaOff = true
    if (line.includes("STRING ARENA NEVER CARVED")) out.strArenaOff = true
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
  /* col 1 is workingSet, col 2 is privateCommit (pmon.c writes five
   * columns: ms, workingSet, privateCommit, pageFaults, cpuMs). BOTH are
   * read because the two answer different questions and this workload
   * moves them by different factors -- and because the only mechanism
   * available on heap pages returns one of them and not the other. */
  const at = (ms, col) => {
    let best = null, bd = Infinity
    for (const r of rows) { const d = Math.abs(+r[0] - ms); if (d < bd) { bd = d; best = r } }
    return best ? +best[col] : 0
  }
  const settledMs = ph.has('IDLE-60s') ? ph.get('IDLE-60s') : null
  /* Nearest whole SAMPLE, so a span can be taken between two phases. cols
   * 3 and 4 are pageFaults and cpuMs -- the pair that answers what a page
   * return would COST, as opposed to what it could recover. */
  const row = (ms) => {
    let best = null, bd = Infinity
    for (const r of rows) { const d = Math.abs(+r[0] - ms); if (d < bd) { bd = d; best = r } }
    return best
  }
  const span = (a, b) => {
    if (!ph.has(a) || !ph.has(b)) return null
    const ra = row(ph.get(a)), rb = row(ph.get(b))
    const dt = (+rb[0] - +ra[0]) / 1000
    if (dt <= 0) return null
    return { sec: dt, faults: +rb[3] - +ra[3], cpuMs: +rb[4] - +ra[4] }
  }
  return {
    presync: ph.has('PRESYNC-BASELINE') ? at(ph.get('PRESYNC-BASELINE'), 1) : 0,
    settled: settledMs !== null ? at(settledMs, 1) : 0,
    settledCommit: settledMs !== null ? at(settledMs, 2) : 0,
    peak: Math.max(...rows.map((r) => +r[1])),
    peakCommit: Math.max(...rows.map((r) => +r[2])),
    /* The rig marks SYNC-DONE-r1 even when it sent ZERO chunks, so that
     * phase is bookkeeping and not the treatment. The ARM line memrig
     * writes from the knobs it actually used is the signal. Plain
     * indexOf, no regex: three heredocs on this branch have eaten a
     * backslash and turned one into a literal newline. */
    sync: phasesText.indexOf('ARM CHUNKS=0') < 0 && ph.has('SYNC-DONE-r1'),
    burst: span('PRESYNC-BASELINE', 'SYNC-DONE-r1'),
    settling: span('SYNC-DONE-r1', 'SETTLED-r1'),
    plateau: span('SETTLED-r1', 'IDLE-60s'),
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

/* CONTENTION PROVENANCE. A run taken on a loaded box yields census COUNTS
 * that are still exact -- they are facts about what the heap contains --
 * and RSS figures that are not trustworthy, because this rig is bimodal
 * (~21% of runs sit ~30 MiB higher with commit up; mode-blind +/-12.63%
 * against +/-0.26% mode-matched) and load is exactly the pressure that
 * pushes a run into the other mode. So the two classes are labelled
 * differently rather than presented together, and the label travels in the
 * evidence directory rather than in someone's memory. */
const contFile = argAt('--contention') ?? join(DIR, 'CONTENTION.txt')
const CONT = existsSync(contFile) ? readFileSync(contFile, 'utf8') : ''
const CONTENDED = /(^|\n)CONTENDED/.test(CONT)
if (CONT) {
  console.log('\n' + '='.repeat(70))
  console.log(CONT.trim())
  console.log('='.repeat(70))
}
const rss = (v) => mib(v) + (CONTENDED ? ' [CONTENDED]' : '')

console.log('\n== the settled process ==')
console.log('  presync baseline   ' + rss(ws.presync) + ' MiB working set')
console.log('  peak               ' + rss(ws.peak) + ' MiB')
console.log('  settled (+60s)     ' + rss(ws.settled) + ' MiB')
console.log('  retention          ' + rss(ws.settled - ws.presync) + ' MiB above baseline')
if (CONTENDED)
  console.log('  ^ these four are RSS and were taken under load: NOT a floor, NOT\n' +
    '    comparable across arms, NOT mode-matchable. The counts below are.')
console.log('\n  CRT heap busy      ' + mib(crt.busy) + ' MiB in ' + crt.nbusy + ' blocks')
console.log('  CRT heap FREE      ' + mib(crt.free) + ' MiB in ' + crt.nfree +
  ' blocks, mean ' + Math.round(crt.free / crt.nfree) + ' B')
console.log('  CRT uncommitted    ' + mib(crt.unc) + ' MiB')

/* THE CONFIGURATION FIRST, because every size below means something else
 * under the other one, and it is the kind of fact that is obvious to
 * whoever ran it and invisible to everyone after.
 *
 * A ScrUnion -- the node behind every populated `T | null` field -- is 48
 * bytes, 64 with its ScrCycHdr. Where it comes from depends entirely on
 * whether the cycle arena is running:
 *
 *   arena ON   (SCR_CYC_ARENA 1, budget 0: every shipping build) the node
 *              is bump-carved out of a 64 KiB chunk, and the only malloc
 *              is one 64 KiB block per ~1,020 nodes. Union nodes NEVER
 *              appear as 64-byte CRT-heap blocks.
 *   arena OFF  scr_cyc_alloc_miss falls through scr_pool_take to
 *              calloc(1, 64), so EVERY union node is its own 64-byte
 *              block on the heap.
 *
 * SCR_RC_AUDIT forces scr_cyc_arena_on() to 0; so does SCR_CYCLE_ARENA=0,
 * or exceeding a budget if one is set. So a histogram taken under RC audit
 * and one taken under a shipping build are histograms of two different
 * allocators, and the >=64 B population is not the same population. They
 * must never be compared, and this file refuses rather than let them be. */
console.log('\n== [0] the allocator configuration these sizes only mean anything under ==')
const arenaOn = !cs.arenaOff && (cs.cycCarved ?? 0) > 0
const strOn = !cs.strArenaOff && (cs.strCarved ?? 0) > 0
console.log('  cycle arena  ' + (arenaOn ? 'ON' : 'OFF') +
  '   carved=' + (cs.cycCarved ?? 0) + ' chunks=' + cs.cycChunks + ' held=' + cs.cycHeld)
console.log('  string arena ' + (strOn ? 'ON' : 'OFF') + '   carved=' + (cs.strCarved ?? 0))
ok(arenaOn,
  'the cycle arena was ON (carved>0 and no "ARENA NEVER CARVED" refusal), so union\n' +
  '        nodes were bump-carved and are ABSENT from the block-size histogram')
{
  const b64 = hc.sizes.get(64)
  console.log('  cross-check: ' + (b64 ? b64.n : 0) + ' busy blocks at exactly 64 B' +
    (arenaOn
      ? ' — consistent with union nodes\n        being arena-carved rather than malloc\'d; these 64 B blocks are something else.'
      : ' — under an arena-OFF build these\n        WOULD be union nodes and the attribution below does not hold.'))
}

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
/* An assertion whose denominator is an RSS figure cannot pass or fail on a
 * contended sample -- it would be adjudicating load. Reported as a NOTE
 * instead, so the reading is still visible and is not mistaken for a
 * verdict. The pure-count assertions around it are unaffected. */
const okRss = (cond, msg) => {
  if (CONTENDED) { console.log('  NOTE  ' + msg + '  (RSS denominator, contended: not adjudicated)'); return }
  ok(cond, msg)
}
okRss(arenaBytes / ws.settled < 0.20,
  'arenas are under 20% of settled working set (' + (100 * arenaBytes / ws.settled).toFixed(1) + '%)')
/* POST-SYNC ONLY. This and the pinning bound below describe the heap a
 * history sync LEAVES BEHIND. On the CHUNKS=0 control no sync ran, so
 * there is no fragmentation to hold and the relation is expected to
 * invert -- asserting it there would be adjudicating the absence of the
 * treatment. An assertion that cannot apply must say so rather than fail:
 * a red line that means nothing trains the reader to ignore red lines. */
const okSync = (cond, msg) => {
  if (!ws.sync) { console.log('  N/A   ' + msg + '  (no sync in this arm: post-sync assertion, not applicable)'); return }
  ok(cond, msg)
}
okSync(crt.free > crt.busy,
  'the heap holds MORE committed-free than busy (' + mib(crt.free) + ' vs ' + mib(crt.busy) + ' MiB)')

/* THE AMPLIFICATION BOUND, so a real mechanism is not mistaken for a
 * magnitude. scr_cyc_ar_give releases a chunk only when `used` reaches
 * zero, so ONE live node pins a whole 64 KiB chunk: at ~1,020 nodes per
 * chunk that is a 1,020x amplification, and it sounds like it could be
 * the retention. It cannot be, and the ceiling is in this run's own
 * numbers rather than in an argument: whatever the arena is holding at
 * exit is `held` chunks, and every one of those is a BUSY 64 KiB block on
 * the heap -- corroborated independently by the histogram's blocks of
 * exactly 65,536 B. So sparse-survivor pinning is bounded above by the
 * arena's held total and sits entirely on the busy side; it cannot
 * account for a byte of the committed-FREE space. */
{
  const pin = cs.cycHeld * 65536
  console.log('  sparse-survivor chunk pinning is bounded at ' + mib(pin) +
    ' MiB (' + cs.cycHeld + ' chunks held), and it is BUSY, not free')
  okSync(pin < crt.free * 0.25,
    'that bound is under a quarter of the committed-free space (' + mib(pin) +
    ' vs ' + mib(crt.free) + ' MiB) — the 1,020x amplification is real and is NOT the retention')
}
okRss(Math.abs(crt.free - (ws.settled - ws.presync)) / (ws.settled - ws.presync) < 0.15,
  'committed-free space accounts for the retention to within 15% (' + mib(crt.free) +
  ' free vs ' + mib(ws.settled - ws.presync) + ' retained)')

console.log('\n== [3] the string arena, which cannot free a chunk at all ==')
console.log('  string chunks ' + cs.strChunks + ' = ' + mib(cs.strChunks * 65536) + ' MiB, listgive=' + cs.strGive)
ok(cs.strGive === 0, 'scr_str_ar_give is never reached: listgive=0, so nothing is ever recycled')
ok(cs.strChunks * 65536 < 0.06 * ws.settled,
  'and it is under 6% of settled — a real defect, NOT the retention (' +
  (100 * cs.strChunks * 65536 / ws.settled).toFixed(1) + '%)')

/* RESIDUE SHAPE, NOT ALLOCATION ORIGIN.
 *
 * The sizes below classify HOLES. The NT heap coalesces a freed block with
 * adjacent free neighbours, so a hole of size X may be several smaller dead
 * blocks merged, and the merge stops where a live block sits. A hole is
 * then the SPACING BETWEEN SURVIVORS rather than a size anything asked for.
 *
 * Not hypothetical here. An exact 8-byte-bucket table over the ALLOCATION
 * side finds buckets 1320, 1328 and 1352 populated and 1344 ABSENT,
 * identically in a sync run and in a control. Nothing requests 1,344 bytes,
 * so 15,766 holes of it cannot be an allocation site.
 *
 * CONSEQUENCE, stated because a table of shares implies they are disjoint
 * and they are NOT: a hole counted at 1,344 may be the coalesced remains of
 * blocks allocated on a ladder this file also counts. The powers-of-two
 * figure is therefore a LOWER BOUND on that ladder's share of the residue,
 * the 1,344 figure is not a separate mechanism, and the two must not be
 * summed or ranked against one another.
 *
 * WHAT THIS CENSUS CANNOT DO: tell a coalesced hole from a virgin one.
 * PROCESS_HEAP_ENTRY carries no provenance for a free block -- HeapWalk
 * says where it is and how big, and nothing about what it was.
 *
 * WHAT IT CAN DO, and what settles it: move the survivors and watch. Payload
 * fixed, only history-sync CONCURRENCY varied (CHUNK_GAP_MS): busy stays
 * within 7% while free falls 45.37 -> 3.60 MiB, the 1,344 class goes
 * 15,758 -> 35, AND the powers-of-two share goes 5.53 -> 0.96 MiB. Two
 * supposedly distinct categories collapsing together under ONE placement
 * change is what proves they are the same bytes at different stages. */
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
    ? '      -> a large 3*2^n population EXISTS, and it is CONSISTENT with boxing:\n' +
      '         16,023 emitted sites (scr_dyn_obj_set_lit 11,512, _present_lit 4,508,\n' +
      '         plain 3) all write this array, all inside sc_td_ converters. Consistent\n' +
      '         is not confirmed -- emitted sites are not executions. The CHUNKS=0\n' +
      '         control is what decides it; without that run, claim nothing.'
    : '      -> entries arrays are not a major component of the free space, whatever\n' +
      '         the emitted site count says.')

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

  /* [6] The array ladder, which the burst profile says should dominate:
   * scr_array.c:172 is 74.6% of everything allocated during the sync, at
   * 0.00% survival and a mean near 1 KB. scr_arr_grow requests cap*8
   * doubling from 4, so its sizes are EXACT POWERS OF TWO -- separable
   * from 3*2^n above 24 and from the dense multiples of 8 the string
   * allocator produces. */
  const POW2 = []
  for (let b = 5; b <= 20; b++) POW2.push(1 << b)
  let pN = 0, pB = 0
  for (const [sz, r] of hc.free) if (POW2.includes(sz)) { pN += r.n; pB += r.bytes }
  console.log('\n  [6] holes at EXACT powers of two (scr_arr_grow, cap*8 doubling): ' +
    pN + ' holes, ' + mib(pB) + ' MiB = ' + (100 * pB / allB).toFixed(1) + '% of free bytes')
  console.log(pB / allB >= 0.3
    ? '      -> CONSISTENT with the burst profile: 1.35M array reallocs at 0.00%\n' +
      '         survival are the residue. Still needs CHUNKS=0 to show it is the SYNC.'
    : '      -> NOT dominated by the array ladder, which the burst profile did not\n' +
      '         predict. Attribute the remainder before claiming anything.')

  /* [7] THE HEADLINE, reported as its own number rather than left to be
   * inferred from the distribution above. This is the figure that decides
   * whether the CRT-heap page route is worth anything at all. */
  if (hc.page) {
    const shaped = 100 * hc.page.pageBytes / crt.free
    console.log('\n== [7] THE PAGE-SHAPED FRACTION OF THE COMMITTED-FREE SPACE ==')
    console.log('  committed-free   ' + mib(crt.free) + ' MiB in ' + crt.nfree + ' blocks')
    console.log('  contiguous runs  ' + hc.page.runs + ', longest ' + hc.page.runMax + ' B')
    console.log('  PAGE-SHAPED      ' + hc.page.pages + ' whole 4 KiB pages = ' +
      mib(hc.page.pageBytes) + ' MiB = ' + shaped.toFixed(2) + '% of the free space')
    console.log('  (a CEILING: computed from where the live blocks actually are.')
    console.log('   No reclaimer on any OS can return more than this.)')

    /* AND WHAT COULD ACT ON IT, because a prize we cannot touch is not a
     * prize. Measured by tests/perf/pagecensus/vmprobe.c on this host
     * (Windows 11 26200, x86_64, zig 0.16.0 cc -O2), 4096 chunks of 64 KiB
     * keeping one page each -- the arena's own shape:
     *
     *   arm  chunk from    call                   dWS      dCOMMIT  ns/page
     *   1    malloc        DiscardVirtualMemory  -224.05    +0.00     3719
     *   2    VirtualAlloc  VirtualFree DECOMMIT  -239.99  -240.00      456
     *   3    VirtualAlloc  DiscardVirtualMemory  -240.00    +0.00     2255
     *
     * On CRT-heap pages THE HEAP OWNS THE RESERVATION, so MEM_DECOMMIT is
     * not available to us -- it needs the reservation and is not
     * transparent (a decommitted page reads back as an access violation,
     * not a soft fault, so the owner must re-commit before reusing it).
     * That leaves arm 1: DiscardVirtualMemory, which is transparent and
     * works on memory this process did not reserve.
     *
     * AND IT RETURNS WORKING SET ONLY, NOT COMMIT. That is not a caveat,
     * it decides whether this answers the complaint at all: "idle 10 MB,
     * 70-100 MB after a sync, never returns" is a WORKING SET observation
     * if it came from Task Manager's default column, and a COMMIT one if
     * it came from private bytes. Discard moves the first and leaves the
     * second exactly where it was. */
    const usable = hc.page.pageBytes
    console.log('\n  what could act on it, on THIS host (vmprobe.c):')
    console.log('    MEM_DECOMMIT          NOT AVAILABLE — the CRT heap owns the reservation,')
    console.log('                          and it is not transparent (re-commit required).')
    console.log('    DiscardVirtualMemory  available, transparent, ~3.7 us/page on malloc"d')
    console.log('                          memory; recovers WORKING SET only.')
    console.log('    => reachable here:    ' + mib(usable) + ' MiB of WORKING SET, and')
    console.log('       0.00 MiB of COMMIT. Settled was ' + mib(ws.settled) +
      ' MiB working set against ' + mib(ws.settledCommit) + ' MiB commit.')
    console.log('       The complaint ("idle 10 MB, 70-100 MB after a sync") is a Task')
    console.log('       Manager reading, whose default Memory column IS the working set,')
    console.log('       so this lands on the number the user is actually watching.')

    /* [8] WHAT IT WOULD COST, which is the other constraint ("nao quero
     * perder performance alguma") and is answerable from this run's own
     * counters rather than from a new instrument.
     *
     * A discarded page is not paid for at discard; it is paid for if and
     * when the allocator hands that hole back out and something touches
     * it. So the cost is a RATE, and pmon already recorded the thing that
     * bounds it: page faults per second, phase by phase. A plateau that
     * takes essentially no faults is a plateau that would not fault the
     * discarded pages back either. */
    const P = ws.plateau, B = ws.burst
    if (P && B) {
      const NS_REFAULT = 1131   /* vmprobe arm 1: 1146 ns re-touch vs 15 ns null */
      const NS_DISCARD = 3719   /* vmprobe arm 1: the DiscardVirtualMemory call */
      const pages = hc.page.pages
      const refaultMs = pages * NS_REFAULT / 1e6
      const discardMs = pages * NS_DISCARD / 1e6
      console.log('\n== [8] WHAT RETURNING IT WOULD COST ==')
      console.log('  page faults, by phase (pmon, this run):')
      console.log('    the burst        ' + B.sec.toFixed(1) + 's  ' +
        B.faults.toLocaleString() + ' faults = ' + Math.round(B.faults / B.sec).toLocaleString() +
        '/s   cpu ' + Math.round(B.cpuMs) + 'ms')
      console.log('    settled plateau  ' + P.sec.toFixed(1) + 's  ' +
        P.faults.toLocaleString() + ' faults = ' + Math.round(P.faults / P.sec).toLocaleString() +
        '/s   cpu ' + Math.round(P.cpuMs) + 'ms')
      console.log('  discarding ' + pages.toLocaleString() + ' pages costs ~' +
        discardMs.toFixed(0) + ' ms ONCE, paid on an idle plateau running at ' +
        (100 * P.cpuMs / (P.sec * 1000)).toFixed(1) + '% CPU.')
      console.log('  faulting them ALL back costs ~' + refaultMs.toFixed(0) +
        ' ms, and only a sync would touch that many —')
      console.log('  which is ' + (100 * refaultMs / B.cpuMs).toFixed(2) +
        '% of the ' + Math.round(B.cpuMs) + ' ms of CPU that sync already spends.')
      const verdict = (P.faults / P.sec) < 5
      console.log(verdict
        ? '  => the plateau takes ~0 faults/s, so the discard is FREE while idle, and the\n' +
          '     worst-case repayment is a rounding error on the next sync. The performance\n' +
          '     constraint is satisfied by arithmetic, not by hope.'
        : '  => the plateau faults at a real rate; a discard would be repaid during idle,\n' +
          '     and the policy must skip the allocator hot free-list head.')
    }
  }
}

console.log(fails ? '\nRECONCILE FAILED (' + fails + ')' : '\nRECONCILE OK')
process.exit(fails ? 1 : 0)
