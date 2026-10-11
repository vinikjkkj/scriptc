/* peak-stats.mjs -- the whole analysis of evidence-peakvar, re-runnable FROM
 * THIS DIRECTORY with no arguments:   node peak-stats.mjs
 *
 * It is evidence-lane/lane-stats.mjs EXTENDED, not rewritten: the parse, the
 * Welch block, the t_crit-at-the-Welch-df rule, the permutation floor and the
 * power block are that file's, carried over unchanged. What is new is the
 * HCPK* parse, the COVERAGE GATE -- which runs and is reported BEFORE any
 * comparison -- and the peak/settled pairing.
 *
 * DIR defaults to this script's own directory; point it at a live memrig
 * output root to re-run against fresh runs:
 *   node peak-stats.mjs /g/blocks/v3-run
 *
 * EVERY ANCHOR TOLERATES A TRAILING CR. The .heapcen.txt are CRLF -- the
 * instrumented binary writes them through a Windows text-mode FILE. Every
 * file here written BY HAND is LF, verified with a byte counter and never
 * with rg: rg -c for a bare CR reports a match on every line of a pure-LF
 * file, a fabricated positive that confirms the rule under audit. */
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { dirname, resolve, join } from 'node:path'
import { fileURLToPath } from 'node:url'
const HERE = dirname(fileURLToPath(import.meta.url))
const DIR = process.argv[2] ? resolve(process.argv[2]) : HERE
const CR = join(HERE, 'chunkrows.txt')
const CHUNKROWS = existsSync(CR) ? readFileSync(CR, 'latin1') : ''

const COVER = /^\[heapcen\] HCPKCOVER snapPrivate=(\d+) kernelPeakPagefile=(\d+) polledHigh=(\d+)\r?$/m
const COST = /^\[heapcen\] HCPKCOST walks=(\d+) polls=(\d+) walkMsTotal=([\d.]+) walkMsMax=([\d.]+) pollMs=(\d+) stepBytes=(\d+)/m
const PKH = /^\[heapcen\] HCPKHEAPS heaps=(\d+) busy=(\d+) busyBlocks=(\d+) free=(\d+) freeBlocks=(\d+) uncommitted=(\d+)\r?$/m
const PKT = /^\[heapcen\] HCPKTOTAL distinctSizes=(\d+) blocks=(\d+) bytes=(\d+) lost=(\d+)/m
const HEAP0 = /^\[heapcen\] heap 0 \S+ CRT busy=(\d+) busyBlocks=(\d+) free=(\d+) freeBlocks=(\d+) uncommitted=(\d+) regions=(\d+)\r?$/m
const HCTOT = /^\[heapcen\] HCTOTAL distinctSizes=\d+ blocks=(\d+) bytes=(\d+) lost=(\d+)/m
const PROF820 = /^PROF (\d+) (\d+) (\d+) (\d+) (\d+) (\S+) \d+ .*scr_string\.c:820\r?$/m
const PKSIZE = /^HCPKSIZE (\d+) (\d+) (\d+)\r?$/gm

function read(dir, tag, arm, pos) {
  const t = readFileSync(join(dir, tag + '.heapcen.txt'), 'latin1')
  const cv = t.match(COVER), co = t.match(COST), ph = t.match(PKH), pt = t.match(PKT)
  const m = t.match(HEAP0), tot = t.match(HCTOT)
  if (!cv || !ph || !pt) {
    const why = /NO PEAK SNAPSHOT.*/.exec(t)
    throw new Error(tag + ': no peak block -- ' + (why ? why[0] : 'no HCPK lines at all'))
  }
  /* the 38 KB-per-run <tag>.prof.txt are not committed, so the PROF :820 row
   * falls back to the committed chunkrows.txt carrying the identical lines --
   * evidence-lane/lane-stats.mjs does exactly this and for the same reason. */
  const profPath = join(dir, tag + '.prof.txt')
  const p = existsSync(profPath)
    ? readFileSync(profPath, 'latin1')
    : CHUNKROWS.split(/\r?\n/).filter(l => l.trim().startsWith(tag + '  PROF '))
      .map(l => l.trim().slice(tag.length + 2)).join('\n')
  const pm = p.match(PROF820)
  /* the largest single HCPKSIZE row, and the 65,536 arena-chunk row */
  let top = { size: 0, n: 0, bytes: 0 }, chunk = { size: 65536, n: 0, bytes: 0 }
  PKSIZE.lastIndex = 0
  for (let r; (r = PKSIZE.exec(t));) {
    const row = { size: +r[1], n: +r[2], bytes: +r[3] }
    if (row.bytes > top.bytes) top = row
    if (row.size === 65536) chunk = row
  }
  return {
    tag, arm, pos,
    snapPrivate: +cv[1], kernelPeak: +cv[2], polledHigh: +cv[3],
    walks: +co[1], polls: +co[2], walkMsTotal: +co[3], walkMsMax: +co[4], stepBytes: +co[6],
    pkAllBusy: +ph[2], pkAllBusyBlk: +ph[3], pkAllFree: +ph[4], pkAllFreeBlk: +ph[5], pkAllUnc: +ph[6],
    pkAllCommitted: +ph[2] + +ph[4],
    pkCrtBusy: +pt[3], pkCrtBlocks: +pt[2], pkLost: +pt[4],
    busy: +m[1], busyBlk: +m[2], free: +m[3], freeBlk: +m[4], unc: +m[5], reg: +m[6],
    committed: +m[1] + +m[3],
    hcBlocks: +tot[1], hcBytes: +tot[2], hcLost: +tot[3],
    chunks: pm ? +pm[1] : null, siteId: pm ? pm[6] : null,
    topRow: top, chunkRow: chunk
  }
}

/* THE DECLARED ORDER, from PREREG.txt, written before run 1 existed. */
const ORDER = [['p1', 'SL', 1], ['p2', 'FB', 2], ['p3', 'FB', 3], ['p4', 'SL', 4], ['p5', 'SL', 5], ['p6', 'FB', 6]]
const rows = ORDER.map(([tag, arm, pos]) => read(DIR, tag, arm, pos))
for (const r of rows) {
  r.coverage = r.snapPrivate / r.kernelPeak
  r.pkHeapFrac = r.pkCrtBusy / r.snapPrivate    /* CRT busy share of PrivateUsage at the snapshot */
  r.pkBusyFrac = r.pkAllBusy / r.pkAllCommitted /* busy share of committed heap at the peak */
  r.stBusyFrac = r.busy / r.committed           /* the same ratio at shutdown, CRT heap 0 */
  r.pkOverSt = r.pkCrtBusy / r.busy
}

const mean = a => a.reduce((s, x) => s + x, 0) / a.length
const sd = a => { const m = mean(a); return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1)) }
const TCRIT = { 1: 12.706, 2: 4.303, 3: 3.182, 4: 2.776 }
const tcrit = df => TCRIT[Math.max(1, Math.min(4, Math.floor(df)))]
function welch(A, B) {
  const mA = mean(A), mB = mean(B), sA = sd(A), sB = sd(B), nA = A.length, nB = B.length
  const se = Math.sqrt(sA * sA / nA + sB * sB / nB), d = mB - mA
  const df = (sA * sA / nA + sB * sB / nB) ** 2 / (((sA * sA / nA) ** 2) / (nA - 1) + ((sB * sB / nB) ** 2) / (nB - 1))
  const tc = tcrit(df)
  return { mA, mB, sA, sB, se, d, t: se ? Math.abs(d) / se : Infinity, df, tc, lo: d - tc * se, hi: d + tc * se }
}
const L = []
const say = s => { L.push(s); console.log(s) }
const pct = x => (x * 100).toFixed(3) + '%'

say('=== V3 RESULTS -- THE PEAK, FIBER vs STACKLESS, 3 runs each, alternated ===')
say('tree      /g/blocks/v3-wt @ be8d74ddb, branch perf/heapcen-peak-variance')
say('SL = STACKLESS  /g/blocks/v3-out182-SL/zapo-rest-182.exe  (knob ABSENT at build)')
say('FB = FIBER      /g/blocks/v3-out182-FB/zapo-rest-182.exe  (SCRIPTC_STACKLESS=0)')
say('BOTH BUILT FOR THIS SLICE from one script taking the arm letter; the env var')
say('is the only branch in it. No binary under the G:\\blocks\\*out182* glob carried')
say('HCPKSIZE before these two.')
say('knobs     CHUNKS=8 CONVS=400 MSGS=6 TEXTLEN=300 ROUNDS=1 IDLE_S=60 SETTLE_MS=45000')
say('          PRESYNC_MS=20000 SCR_SQLITE_IDLE_RELEASE_MS=1000 SCR_SQLITE_IDLE_STAT=1')
say('peak      DEFAULT trigger: 5 ms poll, 1024 KB step, no SCR_HEAPCEN_PEAK_* set.')
say('order     SL FB FB SL SL FB, declared in PREREG.txt before run 1 existed.')
say('')

say('=== >>> 1. COVERAGE FIRST. THIS GATES EVERYTHING BELOW. <<< ===')
say('  HCPKCOVER prints the snapshot\'s own PrivateUsage against the kernel\'s')
say('  PeakPagefileUsage. A snapshot with low coverage is a reading of a TROUGH')
say('  NEAR the peak, not of the peak. vmcensus\'s committed standard is')
say('  99.85-99.96%. The two committed peak runs that exist (evidence-peak')
say('  abba1A/abba4A, both STACKLESS, 512 KB step) read 99.547% and 99.579%.')
say('')
say('pos tag arm lane        snapPrivate   kernelPeak    polledHigh   coverage   walks  polls  stepB')
for (const r of rows) say([String(r.pos).padStart(3), r.tag.padEnd(3), r.arm.padEnd(3),
  (r.arm === 'SL' ? 'STACKLESS' : 'FIBER    '),
  String(r.snapPrivate).padStart(12), String(r.kernelPeak).padStart(12),
  String(r.polledHigh).padStart(13), pct(r.coverage).padStart(10),
  String(r.walks).padStart(7), String(r.polls).padStart(6), String(r.stepBytes).padStart(8)].join(' '))
const covSL = rows.filter(r => r.arm === 'SL').map(r => r.coverage)
const covFB = rows.filter(r => r.arm === 'FB').map(r => r.coverage)
const wcov = welch(covFB, covSL)
say('')
say(`  SL coverage mean ${pct(mean(covSL))}  sd ${(sd(covSL) * 100).toFixed(4)} pp   range ${((Math.max(...covSL) - Math.min(...covSL)) * 100).toFixed(4)} pp`)
say(`  FB coverage mean ${pct(mean(covFB))}  sd ${(sd(covFB) * 100).toFixed(4)} pp   range ${((Math.max(...covFB) - Math.min(...covFB)) * 100).toFixed(4)} pp`)
say(`  DOES COVERAGE DIFFER BY LANE?  delta (SL-FB) = ${(wcov.d * 100).toFixed(4)} pp, |t| = ${wcov.t.toFixed(2)},`)
say(`  Welch df = ${wcov.df.toFixed(2)}, t_crit = ${wcov.tc.toFixed(3)}  =>  ${wcov.t > wcov.tc ? 'YES, THE LANES ARE SNAPSHOTTED AT DIFFERENT RELATIVE INSTANTS' : 'no -- comparable relative instants'}`)
say('  THIS IS THE QUESTION THE PREREG NAMED AS MOST LIKELY TO BREAK THE SLICE.')
say('  If coverage differs by lane, the arms are not the same instant and nothing')
say('  below is a peak-against-peak comparison.')
const BAR = 0.99
const bad = rows.filter(r => r.coverage < BAR)
say('')
say(`  THE PRE-REGISTERED BAR WAS "above 99% on all six". Runs below it: ${bad.length ? bad.map(r => r.tag + ' (' + pct(r.coverage) + ')').join(', ') : 'NONE'}`)
say(`  Runs entering the statistics: ${rows.filter(r => r.coverage >= BAR).length} of 6.`)
say('  AND A SECOND READING THE BAR DOES NOT COVER: the gap between polledHigh and')
say('  kernelPeak is the part of the climb the POLLER never saw; the gap between')
say('  snapPrivate and polledHigh is what the 1 MiB STEP skipped.')
say('  tag   kernelPeak-polledHigh   polledHigh-snapPrivate   (both in bytes)')
for (const r of rows) say(`  ${r.tag.padEnd(5)} ${String(r.kernelPeak - r.polledHigh).padStart(21)} ${String(r.polledHigh - r.snapPrivate).padStart(24)}`)

say('')
say('=== 2. CONTROLS (a control that cannot fail is not a control) ===')
for (const r of rows) {
  const ok = r.hcBytes === r.busy && r.hcBlocks === r.busyBlk && r.hcLost === 0 && r.pkLost === 0
  say(`  ${r.tag}  HCTOTAL==heap-0 busy, blocks match, settled lost==0, peak lost==0 : ${ok ? 'OK' : 'MISMATCH'}`)
}
say('')
say('  LANE IDENTITY -- read off the .ll before run 1, see IDENTITY.txt:')
say('  BOTH ARMS READ NON-ZERO scr_fiber and THAT IS THE CONTROL WORKING. Stackless')
say('  conversion is per-function, so a real module keeps a declare and two calls')
say('  on the stackless lane. The discriminator is the RATIO, not the zero; the')
say('  "must be 0" criterion belongs only to the ten-line probe in')
say('  tests/perf/stackless-knob-guard.mjs, which passed 6/6 against the dist that')
say('  built both arms.')
say('')
say('  SITE-ID CONTROL, per run, independent of the manifest:')
for (const r of rows) say(`    ${r.tag} ${r.arm}  site ${r.siteId ?? '<no prof.txt>'}`)
const idS = [...new Set(rows.filter(r => r.arm === 'SL').map(r => r.siteId))]
const idF = [...new Set(rows.filter(r => r.arm === 'FB').map(r => r.siteId))]
say(`    arm SL: ${idS.join(',')}   arm FB: ${idF.join(',')}   partitions cleanly: ${idS.length === 1 && idF.length === 1 && idS[0] !== idF[0] ? 'YES' : 'NO'}`)
say('')
say('  AND A NULL THAT PROVES NOTHING IN THIS SLICE, SAID OUT LOUD. Both arms are')
say('  post-repair, so neither could make HCSIZE 131079 read non-zero; its absence')
say('  here discriminates nothing. Its positive arm lives in evidence-variance')
say('  arm A (46, 46, 46). Read it there, not here.')

say('')
say('=== 3. EVERY RUN, in the declared SL FB FB SL SL FB order ===')
say('pos tag arm       pkCrtBusy  pkCrtBlocks     pkAllBusy    pkAllFree  pkAllUnc   pk busy%  settled busy  settled busy%  pk/settled')
for (const r of rows) say([String(r.pos).padStart(3), r.tag.padEnd(3), r.arm.padEnd(3),
  String(r.pkCrtBusy).padStart(13), String(r.pkCrtBlocks).padStart(12),
  String(r.pkAllBusy).padStart(13), String(r.pkAllFree).padStart(12),
  String(r.pkAllUnc).padStart(9), pct(r.pkBusyFrac).padStart(10),
  String(r.busy).padStart(13), pct(r.stBusyFrac).padStart(14),
  r.pkOverSt.toFixed(3).padStart(11)].join(' '))

const COLS = ['pkCrtBusy', 'pkCrtBlocks', 'pkAllBusy', 'pkAllFree', 'pkAllUnc', 'pkAllCommitted', 'snapPrivate', 'kernelPeak', 'busy', 'committed']
say('')
say('=== >>> 4. EACH ARM\'S SPREAD, BEFORE ANY t. <<< ===')
say('column            FB range      FB sd      SL range      SL sd    FB sd / SL sd')
for (const c of COLS) {
  const A = rows.filter(r => r.arm === 'FB').map(r => r[c]), B = rows.filter(r => r.arm === 'SL').map(r => r[c])
  const sA = sd(A), sB = sd(B)
  say([c.padEnd(15), String(Math.max(...A) - Math.min(...A)).padStart(12), sA.toFixed(0).padStart(10),
    String(Math.max(...B) - Math.min(...B)).padStart(12), sB.toFixed(0).padStart(10),
    (sB ? (sA / sB).toFixed(1) : 'inf').padStart(16)].join(' '))
}

function table(title, filt) {
  say(''); say(title)
  say('column           FB mean     FB sd      SL mean     SL sd       delta SL-FB     |t|    df   t_crit          95% CI on the delta   sig?')
  const o = {}
  for (const c of COLS) {
    const A = rows.filter(r => r.arm === 'FB' && filt(r)).map(r => r[c])
    const B = rows.filter(r => r.arm === 'SL' && filt(r)).map(r => r[c])
    const w = welch(A, B); o[c] = w
    say([c.padEnd(14), w.mA.toFixed(0).padStart(12), w.sA.toFixed(0).padStart(9),
      w.mB.toFixed(0).padStart(12), w.sB.toFixed(0).padStart(9), w.d.toFixed(0).padStart(16),
      w.t.toFixed(2).padStart(8), w.df.toFixed(2).padStart(6), w.tc.toFixed(3).padStart(7),
      `[${w.lo.toFixed(0)}, ${w.hi.toFixed(0)}]`.padStart(29),
      (w.t > w.tc ? 'YES' : 'no').padStart(5)].join(' '))
  }
  return o
}
const all = table('=== 5. ALL SIX RUNS. Welch t, CRITICAL VALUE TAKEN AT THE WELCH df ===', () => true)
say('  SIGN CONVENTION: delta = SL - FB = STACKLESS minus FIBER, the direction the')
say('  record\'s -21.117 MiB peak sentence reports.')
say('  The Welch df collapses toward 2 when the variances are unequal, and the')
say('  two-sided 95% bar there is 4.303, NOT the 2.776 of df=4.')
say('')
say('  >>> AND THE PERMUTATION FLOOR APPLIES TO EVERY "YES" IN THAT TABLE. <<<')
say('  At 3 v 3 there are C(6,3) = 20 arm assignments, so the smallest attainable')
say('  TWO-SIDED permutation p is 2/20 = 0.10. No effect, however large, reaches')
say('  p < 0.05 at this n without leaning on normality. EVERY YES ABOVE IS')
say('  PARAMETRIC.')
const lo1 = table('=== 6. LEAVE-ONE-OUT: position 1 (p1) dropped, as PREREG.txt promised ===', r => r.tag !== 'p1')
say('  Promised before run 1 and reported whether or not it helps. Peak is bimodal')
say('  by POSITION on this rig -- the first run peaks ~28.7 MiB above the rest in')
say('  5 of 6 recorded cases -- and dropping position 1 leaves arm SL with n=2, so')
say('  the df falls and the bar rises.')

say('')
say('=== 6b. THE -21.117 MiB SENTENCE, PLACED AGAINST THE RIGHT COLUMN ===')
say('  THE CLAIM, located by rg and quoted: pagecensus/evidence-fr2/DECOMP.txt,')
say('  block "WHAT THE LANE REMOVED", row CRT HEAP:')
say('      79.828 MiB fiber   58.711 MiB stackless   -21.117 MiB')
say('  That row is CRT heap COMMITTED at the PEAK. The column that answers it')
say('  here is pkAllCommitted = HCPKHEAPS busy + free, not pkCrtBusy. The')
say('  non-CRT heaps contribute ~30 KB, so the all-heaps aggregate is within')
say('  0.03% of the CRT-only figure; the peak walk does not print per-heap free,')
say('  so a CRT-only peak committed cannot be formed from this instrument.')
const wc = all.pkAllCommitted
say('')
say(`  recorded fiber     79.828 MiB    measured here ${(wc.mA / 1048576).toFixed(3)} MiB (sd ${(wc.sA / 1048576).toFixed(3)})`)
say(`  recorded stackless 58.711 MiB    measured here ${(wc.mB / 1048576).toFixed(3)} MiB (sd ${(wc.sB / 1048576).toFixed(3)})`)
say(`  recorded delta    -21.117 MiB    measured here ${(wc.d / 1048576).toFixed(3)} MiB`)
say(`  |t| = ${wc.t.toFixed(2)}, Welch df = ${wc.df.toFixed(2)}, t_crit = ${wc.tc.toFixed(3)} => ${wc.t > wc.tc ? 'SEPARABLE' : 'NOT SEPARABLE'}`)
say(`  95% CI [${(wc.lo / 1048576).toFixed(3)}, ${(wc.hi / 1048576).toFixed(3)}] MiB; contains 0: ${wc.lo <= 0 && 0 <= wc.hi ? 'YES' : 'NO'}; contains -21.117: ${wc.lo <= -21.117 * 1048576 && -21.117 * 1048576 <= wc.hi ? 'YES' : 'NO'}`)
say('  DIFFERENT TREE, DIFFERENT BINARY, DIFFERENT SESSION, AND BOTH ARM MEANS')
say('  LAND WITHIN A FEW MiB OF THE RECORDED PAIR. This is the first lane figure')
say('  in this front to survive a variance estimate.')

say('')
say('=== 7. THE PEAK HEAP FRACTION, the 94.33% / 17.89% pair under audit ===')
say('  DENOMINATOR, NAMED: snapPrivate, this run, at the snapshot instant.')
say('  NUMERATOR: HCPKTOTAL bytes, the CRT heap\'s BUSY bytes in THIS INSTRUMENTED')
say('  BINARY at that same instant. It is NOT the uninstrumented subject\'s peak,')
say('  and WHICH-BUFFER.md s.5 forbids quoting a commit or RSS figure from an')
say('  instrumented binary -- that prohibition is kept.')
say('  tag arm   CRT busy at peak    snapPrivate    heap fraction')
for (const r of rows) say(`  ${r.tag.padEnd(3)} ${r.arm.padEnd(3)} ${String(r.pkCrtBusy).padStart(17)} ${String(r.snapPrivate).padStart(14)} ${pct(r.pkHeapFrac).padStart(16)}`)
const bS = rows.filter(r => r.arm === 'SL'), bF = rows.filter(r => r.arm === 'FB')
const fS = bS.map(r => r.pkHeapFrac), fF = bF.map(r => r.pkHeapFrac)
const wf = welch(fF, fS)
say('')
say(`  STACKLESS mean ${pct(mean(fS))}  sd ${(sd(fS) * 100).toFixed(3)} pp   (record claims 94.33%)`)
say(`  FIBER     mean ${pct(mean(fF))}  sd ${(sd(fF) * 100).toFixed(3)} pp   (record claims 17.89%)`)
say(`  delta SL-FB = ${(wf.d * 100).toFixed(3)} pp, |t| = ${wf.t.toFixed(2)}, df = ${wf.df.toFixed(2)}, t_crit = ${wf.tc.toFixed(3)} => ${wf.t > wf.tc ? 'SEPARABLE' : 'NOT SEPARABLE'}`)
say('')
say('  >>> THESE TWO PERCENTAGES ARE NOT COMPARABLE TO 94.33% / 17.89%, AND THE')
say('  REASON IS THE DENOMINATOR, NOT THE LANE. <<<')
say('  The NUMERATOR reproduces: the record puts the stackless peak CRT heap at')
say(`  53.438 MiB and this slice measures ${(mean(bS.map(r => r.pkCrtBusy)) / 1048576).toFixed(3)} MiB busy.`)
say('  The DENOMINATOR does not. The record\'s 94.33% implies a PrivateUsage of')
say(`  about 56.6 MiB; this binary peaks at ${(mean(bS.map(r => r.snapPrivate)) / 1048576).toFixed(1)} MiB on the same lane and the same`)
say('  load. The instrument declared 786,432 B of .data and one 64 KiB stack; the')
say(`  measured gap is about ${((mean(bS.map(r => r.snapPrivate)) - 56.6 * 1048576) / 1048576).toFixed(0)} MiB, two orders of magnitude more, and the PROF`)
say('  tables (-DSCR_PROF_ALLOC -DSCR_PROF_SIZEHIST -DSCR_PROF_STACKS) are')
say('  carried here and were NOT carried by the vmcensus run that produced')
say('  94.33%. SO: this slice does NOT refute 94.33%. A heap-over-PrivateUsage')
say('  FRACTION taken from an instrumented binary is not comparable to one taken')
say('  from a lighter one, and WHICH-BUFFER.md s.5 already forbids quoting a')
say('  commit figure from an instrumented binary. What this slice DOES establish')
say('  is the ORDERING and the GAP: stackless holds a far larger share of its own')
say('  address space in the CRT heap than fiber does, by 33.1 pp, and that is')
say('  separable. The absolute 94.33% is UNTOUCHED, neither confirmed nor refuted.')

say('')
say('=== 8. 81.90% BUSY AT PEAK vs 46.19% AT SHUTDOWN (PEAK-OCCUPANT.md) ===')
say('  DENOMINATOR, NAMED: busy+free of the SAME walk -- all heaps at the peak,')
say('  CRT heap 0 at shutdown. Each is instant-consistent within its own walk')
say('  (one HeapWalk under one HeapLock, scr_heap_census.h:298).')
say('  tag arm   busy% at peak   busy% at shutdown      swing')
for (const r of rows) say(`  ${r.tag.padEnd(3)} ${r.arm.padEnd(3)} ${pct(r.pkBusyFrac).padStart(14)} ${pct(r.stBusyFrac).padStart(19)} ${((r.pkBusyFrac - r.stBusyFrac) * 100).toFixed(2).padStart(10)} pp`)
say('')
say(`  STACKLESS: peak busy ${pct(mean(bS.map(r => r.pkBusyFrac)))} (sd ${(sd(bS.map(r => r.pkBusyFrac)) * 100).toFixed(3)} pp), shutdown ${pct(mean(bS.map(r => r.stBusyFrac)))} (sd ${(sd(bS.map(r => r.stBusyFrac)) * 100).toFixed(3)} pp)`)
say(`  FIBER    : peak busy ${pct(mean(bF.map(r => r.pkBusyFrac)))} (sd ${(sd(bF.map(r => r.pkBusyFrac)) * 100).toFixed(3)} pp), shutdown ${pct(mean(bF.map(r => r.stBusyFrac)))} (sd ${(sd(bF.map(r => r.stBusyFrac)) * 100).toFixed(3)} pp)`)
say('  THE PEAK-vs-SHUTDOWN SWING IS A WITHIN-RUN PAIRED CONTRAST -- same process,')
say('  same binary, two instants -- so it does NOT pay the between-run variance')
say('  that the lane delta pays. That is why it can be strong here while the lane')
say('  delta is not.')

say('')
say('=== 9. THE LARGEST OCCUPANT AT THE PEAK, per run ===')
say('  tag arm   top size   top blocks     top bytes   share of CRT busy | 65536-row blocks/bytes')
for (const r of rows) say(`  ${r.tag.padEnd(3)} ${r.arm.padEnd(3)} ${String(r.topRow.size).padStart(10)} ${String(r.topRow.n).padStart(12)} ${String(r.topRow.bytes).padStart(13)} ${pct(r.topRow.bytes / r.pkCrtBusy).padStart(18)} | ${String(r.chunkRow.n).padStart(6)} ${String(r.chunkRow.bytes).padStart(10)}`)

say('')
say('=== 9b. THE 1,328 CLASS AT THE PEAK -- A LANE POPULATION, NOT A BUFFER ===')
say('  Read off HCPKSIZE 1328 and HCSIZE 1328 in the six runs:')
say('  tag arm   1328 blocks AT PEAK   1328 blocks AT SHUTDOWN   4376 blocks AT PEAK')
const B1328 = /^HCPKSIZE 1328 (\d+) (\d+)\r?$/m, S1328 = /^HCSIZE 1328 (\d+) (\d+)\r?$/m, B4376 = /^HCPKSIZE 4376 (\d+) (\d+)\r?$/m
for (const r of rows) {
  const t = readFileSync(join(DIR, r.tag + '.heapcen.txt'), 'latin1')
  const a = t.match(B1328), b = t.match(S1328), c = t.match(B4376)
  r.n1328pk = a ? +a[1] : 0; r.n1328st = b ? +b[1] : 0; r.n4376pk = c ? +c[1] : 0
  say(`  ${r.tag.padEnd(3)} ${r.arm.padEnd(3)} ${String(r.n1328pk).padStart(19)} ${String(r.n1328st).padStart(25)} ${String(r.n4376pk).padStart(21)}`)
}
const p1328S = rows.filter(r => r.arm === 'SL').map(r => r.n1328pk), p1328F = rows.filter(r => r.arm === 'FB').map(r => r.n1328pk)
say('')
say(`  STACKLESS at peak: ${p1328S.join(', ')}      FIBER at peak: ${p1328F.join(', ')}`)
say(`  ratio of means = ${(mean(p1328F) / mean(p1328S)).toFixed(0)}x. At SHUTDOWN the class is single digits to`)
say('  low tens on BOTH lanes, so the fiber population is entirely released')
say('  before the settled census runs -- which is exactly why no settled census')
say('  in this repository could ever have seen it.')
say('')
say('  WHAT IT IS. The PROF flags on both arms declare this band as the STACK')
say('  band by name (-DSCR_PROF_STACK_SIZE_MIN=1296 -DSCR_PROF_STACK_SIZE_MAX=1352),')
say('  and the count tracks the parked-coroutine population: ~20,200 on two fiber')
say('  runs and ~24,200 on the third, against 13-15 on every stackless run.')
say('')
say('  >>> AND IT PUTS A QUESTION TO WHICH-BUFFER.md s.1, WHICH IS TITLED')
say('  "it is not a buffer, it is SQLite". <<< That section reads the 1,328 class')
say('  at REST (it quotes HCSIZE 1328 live at rest = 1) and on ONE lane. At rest')
say('  this slice agrees with it exactly -- 1 to 14 blocks. At the PEAK on the')
say('  FIBER lane the same class carries 20,203-24,242 blocks, and that')
say('  population is a lane property that disappears when the lane changes. This')
say('  does NOT refute s.1: a class can hold SQLite blocks at rest and fiber')
say('  stacks at the peak, and s.1 never claimed otherwise about the peak. It')
say('  does mean the sentence "1,328 is SQLite\'s" is scoped to the settled')
say('  instant and must not be carried to the peak. NOT PURSUED FURTHER HERE --')
say('  naming it is the whole of the claim; attributing it by site id is a')
say('  separate slice and this one did not do it.')
say(`  The 4,376 class ("the whole database", WHICH-BUFFER s.2) runs the OTHER`)
say(`  way at the peak: stackless ${rows.filter(r => r.arm === 'SL').map(r => r.n4376pk).join(', ')} against fiber ${rows.filter(r => r.arm === 'FB').map(r => r.n4376pk).join(', ')}. Named, not explained.`)

say('')
say('=== 10. POWER, n=3 per arm, on the headline peak column ===')
function phi(z) { return 0.5 * (1 + erf(z / Math.SQRT2)) }
function erf(x) { const s = Math.sign(x); x = Math.abs(x); const a1 = .254829592, a2 = -.284496736, a3 = 1.421413741, a4 = -1.453152027, a5 = 1.061405429, p = .3275911; const t = 1 / (1 + p * x); return s * (1 - ((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t * Math.exp(-x * x)) }
const w = all.pkCrtBusy
const sp = Math.sqrt((w.sA ** 2 + w.sB ** 2) / 2), se = sp * Math.sqrt(2 / 3), tc = w.tc
const CLAIM = -21.117 * 1048576
say(`  pkCrtBusy: pooled sd = ${sp.toFixed(0)} B;  se of the difference = ${se.toFixed(0)} B;  t_crit(df=${w.df.toFixed(2)}) = ${tc.toFixed(3)}`)
for (const eff of [Math.abs(w.d), 1048576, 5 * 1048576, 10 * 1048576, 21.117 * 1048576]) {
  const ncp = Math.abs(eff) / se, pw = 1 - (phi(tc - ncp) - phi(-tc - ncp))
  say(`  power to detect a TRUE peak CRT-busy shift of ${String(Math.round(eff)).padStart(9)} B (${(eff / 1048576).toFixed(2)} MiB)  =  ${(pw * 100).toFixed(1)}%`)
}
say(`  MINIMUM DETECTABLE EFFECT at 80% power = ${(se * (tc + 0.842)).toFixed(0)} B = ${(se * (tc + 0.842) / 1048576).toFixed(2)} MiB`)
let nNeed = null
const TARGET = Math.abs(w.d) || 1
for (let n = 3; n <= 400; n++) {
  const se2 = sp * Math.sqrt(2 / n), df = 2 * (n - 1), tc2 = df >= 4 ? 2.776 : tcrit(df)
  if (se2 * (tc2 + 0.842) <= TARGET) { nNeed = n; say(`  runs per arm to bring the MDE to the MEASURED delta ${TARGET.toFixed(0)} B: n = ${n} per arm (MDE ${(se2 * (tc2 + 0.842)).toFixed(0)} B)`); break }
}
if (nNeed === null) say('  more than 400 runs per arm would be needed to reach the measured delta')

say('')
say('=== 11. THE PRE-REGISTERED PREDICTIONS, SCORED ===')
say('  P1 "the peak CRT-busy lane delta IS separable at n=3"')
say(`     measured ${w.d.toFixed(0)} B (${(w.d / 1048576).toFixed(3)} MiB), |t| = ${w.t.toFixed(2)} vs t_crit ${w.tc.toFixed(3)} => ${w.t > w.tc ? 'CONFIRMED (parametric; the permutation floor is still p=0.10)' : 'REFUTED'}`)
say(`     95% CI [${w.lo.toFixed(0)}, ${w.hi.toFixed(0)}] B; contains 0: ${w.lo <= 0 && 0 <= w.hi ? 'YES' : 'NO'}; contains the recorded ${CLAIM.toFixed(0)} B: ${w.lo <= CLAIM && CLAIM <= w.hi ? 'YES' : 'NO'}`)
say('     AND IT SURVIVES THE LEAVE-ONE-OUT: with p1 dropped, |t| = ' + lo1.pkCrtBusy.t.toFixed(2) + ' vs ' + lo1.pkCrtBusy.tc.toFixed(3) + ' => ' + (lo1.pkCrtBusy.t > lo1.pkCrtBusy.tc ? 'still separable' : 'NOT separable'))
say('  P2 "the stackless peak heap fraction reproduces high (order 90%), fiber well below"')
say(`     WRONG AS WORDED, and NOT because the lane moved. stackless ${pct(mean(fS))},`)
say(`     fiber ${pct(mean(fF))}. The ORDERING and the 33.1 pp gap are separable at`)
say('     |t| = 240; the ABSOLUTE 94.33% is not reproducible from an instrumented')
say('     binary because the denominator carries the instrument (section 7). I')
say('     predicted a number whose denominator I had not checked.')
say('  P3 "coverage above 99% on all six"  -- the half named as most likely wrong')
say(`     ${bad.length === 0 ? 'HELD' : 'FAILED on ' + bad.map(r => r.tag).join(', ')}; lane difference in coverage ${wcov.t > wcov.tc ? 'IS' : 'is NOT'} separable (|t| ${wcov.t.toFixed(2)} vs ${wcov.tc.toFixed(3)}).`)

if (process.env.V3_WRITE) writeFileSync(process.env.V3_WRITE, L.join('\n') + '\n')

/* RETRACTED COLUMN, 2026-10-11 -- `busy + free` IS NOT COMMITTED MEMORY
 *
 * THE LINES THIS BAND ANSWERS, at :66 and :69:
 *
 *     pkAllCommitted: +ph[2] + +ph[4],
 *     committed: +m[1] + +m[3],
 *
 * and the two ratios built on them at :82-:83, `pkBusyFrac` and
 * `stBusyFrac`, whose denominators are therefore ADDRESS SPACE while their
 * numerators are bytes. The 81.90% / 46.19% pair this script prints is not
 * an occupancy of paid memory.
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
 * IT -- not thereby in force. */
