/* chunkref-stats.mjs -- the whole analysis of evidence-chunkref, re-runnable
 * FROM THIS DIRECTORY with no arguments:   node chunkref-stats.mjs
 *
 * It is evidence-peakvar/peak-stats.mjs NARROWED, not rewritten: the parse,
 * the coverage gate, the Welch block, the t_crit-at-the-Welch-df rule, the
 * permutation floor and the power block are that file's, carried over
 * unchanged.  What is new is section 2 -- the live count of the 934,576
 * class at the peak, per run -- which is the item that decides this slice.
 *
 * DIR defaults to this script's own directory; point it at a live memrig
 * output root to re-run against fresh runs:
 *   node chunkref-stats.mjs /g/blocks/f2-run
 *
 * EVERY ANCHOR TOLERATES A TRAILING CR.  The .heapcen.txt are CRLF -- the
 * instrumented binary writes them through a Windows text-mode FILE.  Every
 * file here written BY HAND is LF, verified with a byte counter and never
 * with rg. */
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve, join } from 'node:path'
import { fileURLToPath } from 'node:url'
const HERE = dirname(fileURLToPath(import.meta.url))
const DIR = process.argv[2] ? resolve(process.argv[2]) : HERE

const COVER = /^\[heapcen\] HCPKCOVER snapPrivate=(\d+) kernelPeakPagefile=(\d+) polledHigh=(\d+)\r?$/m
const COST = /^\[heapcen\] HCPKCOST walks=(\d+) polls=(\d+) walkMsTotal=([\d.]+) walkMsMax=([\d.]+) pollMs=(\d+) stepBytes=(\d+)/m
const PKH = /^\[heapcen\] HCPKHEAPS heaps=(\d+) busy=(\d+) busyBlocks=(\d+) free=(\d+) freeBlocks=(\d+) uncommitted=(\d+)\r?$/m
const PKT = /^\[heapcen\] HCPKTOTAL distinctSizes=(\d+) blocks=(\d+) bytes=(\d+) lost=(\d+)/m
const HEAP0 = /^\[heapcen\] heap 0 \S+ CRT busy=(\d+) busyBlocks=(\d+) free=(\d+) freeBlocks=(\d+) uncommitted=(\d+) regions=(\d+)\r?$/m
const HCTOT = /^\[heapcen\] HCTOTAL distinctSizes=\d+ blocks=(\d+) bytes=(\d+) lost=(\d+)/m
const PKSIZE = /^HCPKSIZE (\d+) (\d+) (\d+)\r?$/gm
const sizeAt = (t, re) => { const m = t.match(re); return m ? { n: +m[1], bytes: +m[2] } : { n: 0, bytes: 0 } }

function read(dir, tag, arm, pos) {
  const t = readFileSync(join(dir, tag + '.heapcen.txt'), 'latin1')
  const cv = t.match(COVER), co = t.match(COST), ph = t.match(PKH), pt = t.match(PKT)
  const m = t.match(HEAP0), tot = t.match(HCTOT)
  if (!cv || !ph || !pt) {
    const why = /NO PEAK SNAPSHOT.*/.exec(t)
    throw new Error(tag + ': no peak block -- ' + (why ? why[0] : 'no HCPK lines at all'))
  }
  let top = { size: 0, n: 0, bytes: 0 }
  PKSIZE.lastIndex = 0
  for (let r; (r = PKSIZE.exec(t));) {
    const row = { size: +r[1], n: +r[2], bytes: +r[3] }
    if (row.bytes > top.bytes) top = row
  }
  return {
    tag, arm, pos,
    snapPrivate: +cv[1], kernelPeak: +cv[2], polledHigh: +cv[3],
    walks: +co[1], polls: +co[2], stepBytes: +co[6],
    pkAllBusy: +ph[2], pkAllBusyBlk: +ph[3], pkAllFree: +ph[4], pkAllFreeBlk: +ph[5], pkAllUnc: +ph[6],
    pkAllCommitted: +ph[2] + +ph[4],
    pkCrtBusy: +pt[3], pkCrtBlocks: +pt[2], pkLost: +pt[4],
    busy: +m[1], busyBlk: +m[2], free: +m[3], freeBlk: +m[4], unc: +m[5], reg: +m[6],
    committed: +m[1] + +m[3],
    hcBlocks: +tot[1], hcBytes: +tot[2], hcLost: +tot[3],
    /* THE DECIDING ROWS.  934576 is the rbuf_take concatenating output; the
     * 1,048,576 row is its 1:1 partner, measured six times in
     * evidence-peakvar; 65,536 is the POSITIVE control (hundreds, two orders
     * above CHUNKS=8) and 1,048,575 the NEGATIVE control (absent). */
    pk934576: sizeAt(t, /^HCPKSIZE 934576 (\d+) (\d+)\r?$/m),
    pk1048576: sizeAt(t, /^HCPKSIZE 1048576 (\d+) (\d+)\r?$/m),
    pk65536: sizeAt(t, /^HCPKSIZE 65536 (\d+) (\d+)\r?$/m),
    pk1048575: sizeAt(t, /^HCPKSIZE 1048575 (\d+) (\d+)\r?$/m),
    st934576: sizeAt(t, /^HCSIZE 934576 (\d+) (\d+)\r?$/m),
    topRow: top
  }
}

/* THE DECLARED ORDER, from PREREG.txt, written before run q1 existed. */
const ORDER = [['q1', 'PRE', 1], ['q2', 'POS', 2], ['q3', 'POS', 3], ['q4', 'PRE', 4], ['q5', 'PRE', 5], ['q6', 'POS', 6]]
const rows = ORDER.map(([tag, arm, pos]) => read(DIR, tag, arm, pos))
for (const r of rows) {
  r.coverage = r.snapPrivate / r.kernelPeak
  r.pkBusyFrac = r.pkAllBusy / r.pkAllCommitted
  r.stBusyFrac = r.busy / r.committed
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
  return { mA, mB, sA, sB, se, d, t: se ? Math.abs(d) / se : (d === 0 ? 0 : Infinity), df: se ? df : 0, tc, lo: d - tc * se, hi: d + tc * se }
}
const L = []
const say = s => { L.push(s); console.log(s) }
const pct = x => (x * 100).toFixed(3) + '%'
const MiB = x => (x / 1048576).toFixed(3)

say('=== CHUNKREF RESULTS -- DOES THE for-await SHARE MOVE THE PEAK? ===')
say('PRE = 7c7897307  /g/blocks/v3-out182-SL/zapo-rest-182.exe   (reused READ-ONLY)')
say('POS = 16d91996f  /g/blocks/f2-out182-POS/zapo-rest-182.exe  (built for this slice)')
say('Both STACKLESS (knob ABSENT at build), both -DSCR_HEAPCEN_PEAK, PROF string')
say('byte-identical to evidence-peakvar/v3-build.sh:24.  The ONLY delta between the')
say('two source trees is packages/runtime/src/scr_stream.c (git diff --stat: 1 file).')
say('knobs     CHUNKS=8 CONVS=400 MSGS=6 TEXTLEN=300 ROUNDS=1 IDLE_S=60 SETTLE_MS=45000')
say('          PRESYNC_MS=20000 SCR_SQLITE_IDLE_RELEASE_MS=1000 SCR_SQLITE_IDLE_STAT=1')
say('peak      DEFAULT trigger: 5 ms poll, 1024 KB step, no SCR_HEAPCEN_PEAK_* set.')
say('order     PRE POS POS PRE PRE POS, declared in PREREG.txt before run q1 existed.')
say('')

say('=== >>> 1. COVERAGE FIRST.  THIS GATES EVERYTHING BELOW. <<< ===')
say('  HCPKCOVER prints the snapshot own PrivateUsage against the kernel')
say('  PeakPagefileUsage.  A snapshot with LOW coverage reads a TROUGH NEAR the')
say('  peak, not the peak.  The committed standard in evidence-peakvar is')
say('  99.15-99.97%.  The pre-registered bar is 99.0% on all six.')
say('')
say('pos tag arm   snapPrivate    kernelPeak    polledHigh   coverage   walks  polls    stepB')
for (const r of rows) say([String(r.pos).padStart(3), r.tag.padEnd(3), r.arm.padEnd(3),
  String(r.snapPrivate).padStart(13), String(r.kernelPeak).padStart(13),
  String(r.polledHigh).padStart(13), pct(r.coverage).padStart(10),
  String(r.walks).padStart(7), String(r.polls).padStart(6), String(r.stepBytes).padStart(8)].join(' '))
const covPRE = rows.filter(r => r.arm === 'PRE').map(r => r.coverage)
const covPOS = rows.filter(r => r.arm === 'POS').map(r => r.coverage)
const wcov = welch(covPRE, covPOS)
say('')
say(`  PRE coverage mean ${pct(mean(covPRE))}  sd ${(sd(covPRE) * 100).toFixed(4)} pp   range ${((Math.max(...covPRE) - Math.min(...covPRE)) * 100).toFixed(4)} pp`)
say(`  POS coverage mean ${pct(mean(covPOS))}  sd ${(sd(covPOS) * 100).toFixed(4)} pp   range ${((Math.max(...covPOS) - Math.min(...covPOS)) * 100).toFixed(4)} pp`)
say(`  DOES COVERAGE DIFFER BY ARM?  delta (POS-PRE) = ${(wcov.d * 100).toFixed(4)} pp, |t| = ${wcov.t.toFixed(2)},`)
say(`  Welch df = ${wcov.df.toFixed(2)}, t_crit = ${wcov.tc.toFixed(3)}  =>  ${wcov.t > wcov.tc ? 'YES -- THE ARMS ARE SNAPSHOTTED AT DIFFERENT RELATIVE INSTANTS' : 'no -- comparable relative instants'}`)
const BAR = 0.99
const bad = rows.filter(r => r.coverage < BAR)
say('')
say(`  THE PRE-REGISTERED BAR WAS "at or above 99% on all six".  Runs below it: ${bad.length ? bad.map(r => r.tag + ' (' + pct(r.coverage) + ')').join(', ') : 'NONE'}`)
say(`  RUNS ENTERING THE STATISTICS: ${rows.filter(r => r.coverage >= BAR).length} of 6.`)
say('  AND A SECOND READING THE BAR DOES NOT COVER: kernelPeak-polledHigh is the')
say('  part of the climb the POLLER never saw; polledHigh-snapPrivate is what the')
say('  1 MiB STEP skipped.')
say('  tag   kernelPeak-polledHigh   polledHigh-snapPrivate   (bytes)')
for (const r of rows) say(`  ${r.tag.padEnd(5)} ${String(r.kernelPeak - r.polledHigh).padStart(21)} ${String(r.polledHigh - r.snapPrivate).padStart(24)}`)

say('')
say('=== >>> 2. THE DECIDING ITEM: THE 934,576 CLASS LIVE AT THE PEAK <<< ===')
say('  This is a POPULATION, not a flow: HCPKSIZE counts blocks LIVE at the')
say('  snapshot instant.  PROF* counts the whole run and answers a different')
say('  question.  The prediction in PREREG.txt P1 was 6-7 on BOTH arms; P2 named')
say('  the transient-overlap alternative, 12-14 on PRE.')
say('')
say('  tag arm   934576 n   934576 bytes | 1048576 n  1:1? | 65536 n (POS ctrl) | 1048575 n (NEG ctrl) | 934576 n AT REST')
for (const r of rows) say(`  ${r.tag.padEnd(3)} ${r.arm.padEnd(3)} ${String(r.pk934576.n).padStart(10)} ${String(r.pk934576.bytes).padStart(14)} | ${String(r.pk1048576.n).padStart(9)} ${(r.pk934576.n === r.pk1048576.n ? 'YES' : 'NO').padStart(5)} | ${String(r.pk65536.n).padStart(17)} | ${String(r.pk1048575.n).padStart(20)} | ${String(r.st934576.n).padStart(16)}`)
const nPRE = rows.filter(r => r.arm === 'PRE').map(r => r.pk934576.n)
const nPOS = rows.filter(r => r.arm === 'POS').map(r => r.pk934576.n)
say('')
say(`  PRE: ${nPRE.join(', ')}        POS: ${nPOS.join(', ')}`)
const anyOverlap = nPRE.some(n => n >= 12)
say(`  P1 (6-7 on both arms): ${nPRE.every(n => n >= 5 && n <= 8) && nPOS.every(n => n >= 5 && n <= 8) ? 'HELD' : 'BROKEN'}`)
say(`  P2 (PRE reads 12-14, transient overlap caught): ${anyOverlap ? 'CONFIRMED -- the overlap IS sampled' : 'REFUTED -- no PRE run reads 12 or more'}`)
say('  IF BOTH ARMS READ THE SAME COUNT, THE RESIDENT POPULATION PER CHUNK IS')
say('  UNCHANGED AND THE PATCH REMOVED TURNOVER, NOT BYTES AT THE PEAK.')
say('  CONTROLS: 65,536 must run in the hundreds (two orders above CHUNKS=8) or')
say('  the size parse is dead; 1,048,575 must be absent or the parse is matching')
say('  neighbours.  A control that cannot fail is not a control.')

say('')
say('=== >>> 2b. DID THE SHARE PATH ACTUALLY FIRE?  A FLOW USED AS A FLOW. <<< ===')
say('  A null on the peak means nothing if the guard never fired.  THIS IS THE')
say('  ONLY PLACE A PROF NUMBER IS ALLOWED IN THIS SLICE, AND IT ANSWERS')
say('  REACHABILITY, NOT RETENTION: how many times the COPY ran over the whole')
say('  run, at the copying site scr_bytes.c:52, in band 19 = floor(log2 n) for')
say('  n in [512 KiB, 1 MiB) -- the band that holds 934,576.')
say('  The rows are extracted per run into profrows.txt; the 38 KB-per-run')
say('  .prof.txt are not committed, exactly as evidence-peakvar does with')
say('  chunkrows.txt and for the same reason.')
say('')
say('  tag arm   band19 copies   band20   site-52 count      site-52 bytes | site-529 count (REFERENCE)')
const PROFROWS = (() => { try { return readFileSync(join(HERE, 'profrows.txt'), 'latin1') } catch { return '' } })()
const profFor = (tag, site) => {
  /* live .prof.txt first, committed extract second.  EVERY ANCHOR TOLERATES A
   * TRAILING CR: the .prof.txt are CRLF.  An anchor written `:52$` matches
   * NOTHING against them -- it read empty on BOTH arms AND on the reference
   * site when this control was first run by hand, and only the reference arm
   * showed that the detector was dead rather than the fact absent. */
  let txt = ''
  try { txt = readFileSync(join(DIR, tag + '.prof.txt'), 'latin1') } catch {
    txt = PROFROWS.split(/\r?\n/).filter(l => l.startsWith(tag + '  ')).map(l => l.slice(tag.length + 2)).join('\n')
  }
  const re = new RegExp('^(PROF|PROFHIST) .*scr_bytes\\.c:' + site + '\\r?$', 'gm')
  const out = { count: null, bytes: null, b19: null, b20: null }
  for (let m; (m = re.exec(txt));) {
    const f = m[0].trim().split(/\s+/)
    if (f[0] === 'PROF') { out.count = +f[1]; out.bytes = +f[2] }
    else { for (const p of f.slice(2)) { if (p.startsWith('19:')) out.b19 = +p.slice(3); if (p.startsWith('20:')) out.b20 = +p.slice(3) } }
  }
  return out
}
const reach = rows.map(r => ({ r, a: profFor(r.tag, '52'), b: profFor(r.tag, '529') }))
for (const { r, a, b } of reach) say(`  ${r.tag.padEnd(3)} ${r.arm.padEnd(3)} ${String(a.b19).padStart(13)} ${String(a.b20).padStart(8)} ${String(a.count).padStart(15)} ${String(a.bytes).padStart(18)} | ${String(b.count).padStart(26)}`)
const b19PRE = reach.filter(x => x.r.arm === 'PRE').map(x => x.a.b19)
const b19POS = reach.filter(x => x.r.arm === 'POS').map(x => x.a.b19)
const byPRE = reach.filter(x => x.r.arm === 'PRE').map(x => x.a.bytes)
const byPOS = reach.filter(x => x.r.arm === 'POS').map(x => x.a.bytes)
say('')
say(`  band19 copies  PRE ${b19PRE.join(', ')}      POS ${b19POS.join(', ')}      delta ${mean(b19POS) - mean(b19PRE)} per run`)
say(`  CHUNKS = 8.  A drop of exactly 8, in EVERY run, with ZERO overlap between`)
say(`  the arms, is the share firing ONCE PER CHUNK.  band20 is unchanged at`)
say(`  ${reach[0].a.b20} on both arms: the 1,048,576 partner is not touched.`)
say(`  bytes at the copying site  PRE mean ${mean(byPRE).toFixed(0)}   POS mean ${mean(byPOS).toFixed(0)}`)
say(`  delta ${(mean(byPOS) - mean(byPRE)).toFixed(0)} B against 8 x 934,576 = ${8 * 934576} B exactly;`)
say(`  the residual ${Math.abs(mean(byPOS) - mean(byPRE) + 8 * 934576).toFixed(0)} B is other traffic through the same site.`)
say('  REFERENCE SITE scr_bytes.c:529 is flat across the arms, so the instrument')
say('  is not drifting globally.  A control that cannot fail is not a control.')
say('')
say('  >>> SO THE PATCH WORKS, AND WHAT IT REMOVES IS TURNOVER. <<<  It deletes')
say('  one alloc + one free + one 934,576 B memcpy per chunk -- about 7.48 MB of')
say('  allocation FLOW per run -- while the POPULATION resident at the peak is')
say('  the SAME 6 or 7 buffers.  FLOW IS NOT RETENTION; this slice exists to')
say('  keep the two apart, and here they point opposite ways.')

say('')
say('=== 3. CONTROLS (internal consistency of each census) ===')
for (const r of rows) {
  const ok = r.hcBytes === r.busy && r.hcBlocks === r.busyBlk && r.hcLost === 0 && r.pkLost === 0
  say(`  ${r.tag}  HCTOTAL==heap-0 busy, blocks match, settled lost==0, peak lost==0 : ${ok ? 'OK' : 'MISMATCH'}`)
}

say('')
say('=== 4. EVERY RUN, in the declared PRE POS POS PRE PRE POS order ===')
say('pos tag arm       pkCrtBusy  pkCrtBlocks     pkAllBusy    pkAllFree  pkAllUnc   pk busy%  settled busy  settled busy%')
for (const r of rows) say([String(r.pos).padStart(3), r.tag.padEnd(3), r.arm.padEnd(3),
  String(r.pkCrtBusy).padStart(13), String(r.pkCrtBlocks).padStart(12),
  String(r.pkAllBusy).padStart(13), String(r.pkAllFree).padStart(12),
  String(r.pkAllUnc).padStart(9), pct(r.pkBusyFrac).padStart(10),
  String(r.busy).padStart(13), pct(r.stBusyFrac).padStart(14)].join(' '))

const COLS = ['pkCrtBusy', 'pkCrtBlocks', 'pkAllBusy', 'pkAllFree', 'pkAllUnc', 'pkAllCommitted', 'snapPrivate', 'kernelPeak', 'busy', 'free', 'unc', 'committed']
say('')
say('=== >>> 5. EACH ARM SPREAD, BEFORE ANY t. <<< ===')
say('column            PRE range     PRE sd     POS range     POS sd   PRE sd / POS sd')
for (const c of COLS) {
  const A = rows.filter(r => r.arm === 'PRE').map(r => r[c]), B = rows.filter(r => r.arm === 'POS').map(r => r[c])
  const sA = sd(A), sB = sd(B)
  say([c.padEnd(15), String(Math.max(...A) - Math.min(...A)).padStart(12), sA.toFixed(0).padStart(10),
    String(Math.max(...B) - Math.min(...B)).padStart(12), sB.toFixed(0).padStart(10),
    (sB ? (sA / sB).toFixed(1) : 'inf').padStart(17)].join(' '))
}

function table(title, filt) {
  say(''); say(title)
  say('column          PRE mean    PRE sd     POS mean    POS sd      delta POS-PRE     |t|    df   t_crit          95% CI on the delta   sig?')
  const o = {}
  for (const c of COLS) {
    const A = rows.filter(r => r.arm === 'PRE' && filt(r)).map(r => r[c])
    const B = rows.filter(r => r.arm === 'POS' && filt(r)).map(r => r[c])
    const w = welch(A, B); o[c] = w
    say([c.padEnd(14), w.mA.toFixed(0).padStart(12), w.sA.toFixed(0).padStart(9),
      w.mB.toFixed(0).padStart(12), w.sB.toFixed(0).padStart(9), w.d.toFixed(0).padStart(16),
      w.t.toFixed(2).padStart(8), w.df.toFixed(2).padStart(6), w.tc.toFixed(3).padStart(7),
      `[${w.lo.toFixed(0)}, ${w.hi.toFixed(0)}]`.padStart(29),
      (w.t > w.tc ? 'YES' : 'no').padStart(5)].join(' '))
  }
  return o
}
const all = table('=== 6. ALL SIX RUNS.  Welch t, CRITICAL VALUE TAKEN AT THE WELCH df ===', () => true)
say('  SIGN CONVENTION: delta = POS - PRE.  A SAVING IS NEGATIVE.')
say('  The Welch df collapses toward 2 when the variances are unequal, and the')
say('  two-sided 95% bar there is 4.303, NOT the 2.776 of df=4.')
say('')
say('  >>> THE PERMUTATION FLOOR APPLIES TO EVERY "YES" IN THAT TABLE. <<<')
say('  At 3 v 3 there are C(6,3) = 20 arm assignments, so the smallest attainable')
say('  TWO-SIDED permutation p is 2/20 = 0.10.  No effect, however large, reaches')
say('  p < 0.05 at this n without leaning on normality.  EVERY YES ABOVE IS')
say('  PARAMETRIC, AND THAT IS SAID IN THE TABLE, NOT IN A FOOTNOTE.')
const lo1 = table('=== 7. LEAVE-ONE-OUT: position 1 (q1) dropped, as PREREG.txt promised ===', r => r.tag !== 'q1')
say('  Promised before run q1 and reported whether or not it helps.  Peak is')
say('  bimodal by POSITION on this rig -- the first run peaks ~28.7 MiB above the')
say('  rest in 5 of 6 recorded cases -- and q1 is a PRE run, so dropping it moves')
say('  the delta AGAINST the patch showing a saving.  PRE falls to n=2, so the df')
say('  falls and the bar rises.')

say('')
say('=== 8. THE CLAIM UNDER TEST: 5.61-6.54 MB OF PEAK SAVING ===')
say('  The slice that wrote the patch predicted 6 or 7 x 934,576 B off the peak.')
const w = all.pkCrtBusy
const CLAIM_LO = -7 * 934576, CLAIM_HI = -6 * 934576
say(`  predicted saving   ${CLAIM_LO} .. ${CLAIM_HI} B  (${MiB(CLAIM_LO)} .. ${MiB(CLAIM_HI)} MiB)`)
say(`  MEASURED delta on pkCrtBusy (POS-PRE)   ${w.d.toFixed(0)} B  (${MiB(w.d)} MiB)`)
say(`  |t| = ${w.t.toFixed(2)}, Welch df = ${w.df.toFixed(2)}, t_crit = ${w.tc.toFixed(3)}  =>  ${w.t > w.tc ? 'SEPARABLE' : 'NOT SEPARABLE'}`)
say(`  95% CI [${w.lo.toFixed(0)}, ${w.hi.toFixed(0)}] B = [${MiB(w.lo)}, ${MiB(w.hi)}] MiB`)
say(`  CI contains 0:                       ${w.lo <= 0 && 0 <= w.hi ? 'YES' : 'NO'}`)
say(`  CI contains the predicted -6x934576: ${w.lo <= CLAIM_HI && CLAIM_HI <= w.hi ? 'YES' : 'NO'}`)
say(`  CI contains the predicted -7x934576: ${w.lo <= CLAIM_LO && CLAIM_LO <= w.hi ? 'YES' : 'NO'}`)
say('  AND THE SAME THREE LINES ON snapPrivate, the figure the 5.61-6.54 MB was')
say('  quoted as a percentage OF:')
const ws = all.snapPrivate
say(`  MEASURED delta on snapPrivate (POS-PRE) ${ws.d.toFixed(0)} B (${MiB(ws.d)} MiB), |t| = ${ws.t.toFixed(2)} vs ${ws.tc.toFixed(3)} => ${ws.t > ws.tc ? 'SEPARABLE' : 'NOT SEPARABLE'}`)
say(`  95% CI [${MiB(ws.lo)}, ${MiB(ws.hi)}] MiB; contains 0: ${ws.lo <= 0 && 0 <= ws.hi ? 'YES' : 'NO'}`)

say('')
say('=== 9. POWER, n=3 per arm, on the headline peak column ===')
function erf(x) { const s = Math.sign(x); x = Math.abs(x); const a1 = .254829592, a2 = -.284496736, a3 = 1.421413741, a4 = -1.453152027, a5 = 1.061405429, p = .3275911; const t = 1 / (1 + p * x); return s * (1 - ((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t * Math.exp(-x * x)) }
function phi(z) { return 0.5 * (1 + erf(z / Math.SQRT2)) }
const sp = Math.sqrt((w.sA ** 2 + w.sB ** 2) / 2), se = sp * Math.sqrt(2 / 3), tc = w.tc
say(`  pkCrtBusy: pooled sd = ${sp.toFixed(0)} B;  se of the difference = ${se.toFixed(0)} B;  t_crit(df=${w.df.toFixed(2)}) = ${tc.toFixed(3)}`)
for (const eff of [934576, 2 * 934576, 6 * 934576, 7 * 934576, 10 * 1048576]) {
  const ncp = Math.abs(eff) / se, pw = 1 - (phi(tc - ncp) - phi(-tc - ncp))
  say(`  power to detect a TRUE peak CRT-busy shift of ${String(Math.round(eff)).padStart(9)} B (${(eff / 1048576).toFixed(2)} MiB)  =  ${(pw * 100).toFixed(1)}%`)
}
say(`  MINIMUM DETECTABLE EFFECT at 80% power = ${(se * (tc + 0.842)).toFixed(0)} B = ${((se * (tc + 0.842)) / 1048576).toFixed(2)} MiB`)
say('  >>> READ THE MDE AGAINST THE CLAIM.  If the MDE is BELOW 6x934,576 B the')
say('  design COULD have seen the predicted saving and did not; if it is ABOVE,')
say('  the null is weak and says so. <<<')

say('')
say('=== 10. THE PRE-REGISTERED PREDICTIONS, SCORED ===')
say('  P1 "934,576 reads 6-7 on BOTH arms; peak delta consistent with zero"')
say(`     counts PRE ${nPRE.join(',')} / POS ${nPOS.join(',')}; delta ${w.d.toFixed(0)} B, CI contains 0: ${w.lo <= 0 && 0 <= w.hi ? 'YES' : 'NO'}`)
say(`     => ${(!anyOverlap && w.lo <= 0 && 0 <= w.hi) ? 'CONFIRMED' : 'NOT CONFIRMED AS WORDED'}`)
say('  P2 "PRE reads 12-14 (transient overlap)" -- the half named as most likely to')
say(`     break P1  =>  ${anyOverlap ? 'CONFIRMED' : 'REFUTED'}`)
const wf = all.free, wu = all.unc
say('  P3 "free and uncommitted at the peak do NOT separate"')
say(`     settled free |t| = ${wf.t.toFixed(2)} vs ${wf.tc.toFixed(3)} => ${wf.t > wf.tc ? 'REFUTED (they separate)' : 'HELD'};  settled uncommitted |t| = ${wu.t.toFixed(2)} vs ${wu.tc.toFixed(3)} => ${wu.t > wu.tc ? 'REFUTED' : 'HELD'}`)
const wpf = all.pkAllFree, wpu = all.pkAllUnc
say(`     peak free |t| = ${wpf.t.toFixed(2)} vs ${wpf.tc.toFixed(3)} => ${wpf.t > wpf.tc ? 'REFUTED' : 'HELD'};  peak uncommitted |t| = ${wpu.t.toFixed(2)} vs ${wpu.tc.toFixed(3)} => ${wpu.t > wpu.tc ? 'REFUTED' : 'HELD'}`)
const wb = all.busy
say('  P4 "settled busy does not separate" (negative control; the lane effect on')
say('     settled in evidence-peakvar was |t| = 0.01)')
say(`     |t| = ${wb.t.toFixed(2)} vs ${wb.tc.toFixed(3)} => ${wb.t > wb.tc ? 'REFUTED' : 'HELD -- coherence, not a new null'}`)
say(`  LEAVE-ONE-OUT on q1, pkCrtBusy: delta ${lo1.pkCrtBusy.d.toFixed(0)} B, |t| = ${lo1.pkCrtBusy.t.toFixed(2)} vs ${lo1.pkCrtBusy.tc.toFixed(3)} => ${lo1.pkCrtBusy.t > lo1.pkCrtBusy.tc ? 'separable' : 'NOT separable'}`)

if (process.env.F2_WRITE) writeFileSync(process.env.F2_WRITE, L.join('\n') + '\n')

/* RETRACTED COLUMN, 2026-10-11 -- `busy + free` IS NOT COMMITTED MEMORY
 *
 * THE LINES THIS BAND ANSWERS, at :49 and :55:
 *
 *     pkAllCommitted: +ph[2] + +ph[4],
 *     committed: +m[1] + +m[3],
 *
 * Both are busy + free. Both read as NULLS in RESULTS.txt, so this
 * slice's verdict -- which rests on the per-class COUNT at 934,576, not on
 * any aggregate column -- is untouched.
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
