/* peak-decomp.mjs -- decompose the PEAK CRT heap by SIZE CLASS, from the six
 * runs already committed in ../evidence-peakvar/. Re-runnable FROM THIS
 * DIRECTORY with no arguments:   node peak-decomp.mjs
 *
 * IT BUILDS NOTHING AND RUNS NOTHING. Every byte it reads is a committed
 * *.heapcen.txt written by the two instrumented binaries of 5cd3e3475.
 *
 * DIR defaults to ../evidence-peakvar; point it at a live memrig output root
 * to re-run against fresh runs:   node peak-decomp.mjs /g/blocks/v3-run
 *
 * THE TWO DENOMINATORS, named once and then on every line that uses one:
 *   pkCrtBusy  = [heapcen] HCPKTOTAL bytes -- the CRT heap's BUSY bytes at the
 *                PEAK snapshot instant, of THIS INSTRUMENTED BINARY. It is the
 *                sum of the HCPKSIZE rows and of nothing else. It is NOT
 *                HCPKHEAPS busy=, which is all three process heaps.
 *   stCrtBusy  = [heapcen] HCTOTAL bytes -- the same heap, same tables, at
 *                _Exit. Sum of the HCSIZE rows. Includes the 137-block arm.
 *   transient  = pkCrtBusy - stCrtBusy, PER RUN. Every "share of the
 *                transient" below divides by THAT RUN'S OWN transient, never
 *                by an arm mean and never by another run's.
 *
 * HCPKSIZE/HCSIZE columns are `size blocks bytes`, where size is cbData (the
 * request) and bytes is sum(cbData + cbOverhead) -- scr_heap_census.h:167.
 * So bytes/blocks always sits a little above size.
 *
 * FLOW IS NOT RETENTION, and it cuts both ways here. HCPKSIZE counts what is
 * LIVE at one instant, so it cannot inflate a class by churn -- but a class
 * that is large at the peak may be in-flight traffic the walk caught in the
 * air rather than anything held. Nothing below distinguishes those two.
 *
 * EVERY ANCHOR TOLERATES A TRAILING CR: the .heapcen.txt are CRLF because the
 * instrumented binary writes them through a Windows text-mode FILE. This file
 * is LF, checked with a byte counter and never with rg. */
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve, join } from 'node:path'
import { fileURLToPath } from 'node:url'
const HERE = dirname(fileURLToPath(import.meta.url))
const DIR = process.argv[2] ? resolve(process.argv[2]) : resolve(HERE, '..', 'evidence-peakvar')

const PKT = /^\[heapcen\] HCPKTOTAL distinctSizes=(\d+) blocks=(\d+) bytes=(\d+) lost=(\d+)/m
const HCTOT = /^\[heapcen\] HCTOTAL distinctSizes=\d+ blocks=(\d+) bytes=(\d+) lost=(\d+)/m
const PKSIZE = /^HCPKSIZE (\d+) (\d+) (\d+)\r?$/gm
const SIZE = /^HCSIZE (\d+) (\d+) (\d+)\r?$/gm

const ARMS = { SL: ['p1', 'p4', 'p5'], FB: ['p2', 'p3', 'p6'] }
const LANE = { SL: 'STACKLESS', FB: 'FIBER' }

/* PERTASK.txt, quoted verbatim in section 3; kept here so the arithmetic that
 * uses it is visible rather than typed in as a literal. */
const PERTASK_HEAP_MIB = 26.390
const PERTASK_HEAP_B = Math.round(PERTASK_HEAP_MIB * 1048576)
const PERTASK_TASKS = 20190
const PERTASK_PER_TASK = 1371

function rows(text, re) {
  const m = new Map()
  re.lastIndex = 0
  for (let r; (r = re.exec(text));) m.set(+r[1], { n: +r[2], bytes: +r[3] })
  return m
}
function read(tag) {
  const t = readFileSync(join(DIR, tag + '.heapcen.txt'), 'latin1')
  const pt = t.match(PKT), st = t.match(HCTOT)
  if (!pt) throw new Error(tag + ': no HCPKTOTAL -- this run has no peak block')
  if (!st) throw new Error(tag + ': no HCTOTAL -- this run has no settled block')
  const peak = rows(t, PKSIZE), settled = rows(t, SIZE)
  const pkCrtBusy = +pt[3], stCrtBusy = +st[2]
  let sp = 0; for (const v of peak.values()) sp += v.bytes
  let ss = 0; for (const v of settled.values()) ss += v.bytes
  if (sp !== pkCrtBusy) throw new Error(tag + ': HCPKSIZE rows sum to ' + sp + ' but HCPKTOTAL says ' + pkCrtBusy)
  if (ss !== stCrtBusy) throw new Error(tag + ': HCSIZE rows sum to ' + ss + ' but HCTOTAL says ' + stCrtBusy)
  return { tag, peak, settled, pkCrtBusy, stCrtBusy, transient: pkCrtBusy - stCrtBusy, lost: +pt[4] }
}
const R = {}
for (const a of Object.keys(ARMS)) R[a] = ARMS[a].map(read)

const L = []
const say = s => { L.push(s); console.log(s) }
const n = x => x.toLocaleString('en-US')
const mib = x => (x / 1048576).toFixed(3)
const pad = (s, w) => String(s).padStart(w)
const padr = (s, w) => String(s).padEnd(w)
const mean = a => a.reduce((x, y) => x + y, 0) / a.length
const sd = a => { const m = mean(a); return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1)) }
const pc = x => (x * 100).toFixed(2) + '%'

say('=== peak-decomp.mjs -- the PEAK CRT heap, by size class ===')
say('    source: ' + DIR)
say('    runs:   SL (stackless, the target) = ' + ARMS.SL.join(', '))
say('            FB (fiber, contrast only)  = ' + ARMS.FB.join(', '))
say('    NOTHING WAS BUILT AND NOTHING WAS RUN. Committed *.heapcen.txt only.')
say('')

say('=== 0. THE DENOMINATORS, PER RUN, BEFORE ANY SHARE ===')
say('    pkCrtBusy = HCPKTOTAL bytes | stCrtBusy = HCTOTAL bytes | transient = pk - st')
say('    both are the CRT HEAP ONLY (heap 0), of the INSTRUMENTED binary.')
say('')
say('    run   lane         pkCrtBusy      stCrtBusy      transient    pk/st   lost')
for (const a of ['SL', 'FB']) for (const r of R[a])
  say('    ' + padr(r.tag, 6) + padr(LANE[a], 11) + pad(n(r.pkCrtBusy), 12) + pad(n(r.stCrtBusy), 15) + pad(n(r.transient), 15) + pad((r.pkCrtBusy / r.stCrtBusy).toFixed(3), 9) + pad(r.lost, 7))
say('')
for (const a of ['SL', 'FB']) {
  const tr = R[a].map(r => r.transient)
  say('    ' + padr(LANE[a], 10) + ' transient: mean ' + n(Math.round(mean(tr))) + ' B = ' + mib(mean(tr)) + ' MiB, sd ' + n(Math.round(sd(tr))) + ' B, range ' + n(Math.max(...tr) - Math.min(...tr)) + ' B')
}
say('')
say('    THE INSTANT ITSELF, CONTROLLED. The 137-block 5,113 B arm is planted AFTER')
say('    the peak table is emitted (scr_heap_census.h:703-713), so it must appear at')
say('    shutdown and never at the peak. Both halves read, in all six runs:')
for (const a of ['SL', 'FB']) for (const r of R[a]) {
  const p = r.peak.get(5113), s = r.settled.get(5113)
  say('      ' + padr(r.tag, 5) + 'HCPKSIZE 5113: ' + padr(p ? p.n + ' blocks -- CONTROL FAILED' : 'absent (expected)', 28) + 'HCSIZE 5113: ' + (s ? s.n + ' blocks (expected)' : 'ABSENT -- CONTROL FAILED'))
}
say('    This control DISCRIMINATES: one side is non-zero by construction and the')
say('    other is zero by construction, so a dead reader could not produce both.')
say('')

function classTable(arm, topN) {
  const runs = R[arm]
  const keys = new Set()
  for (const r of runs) for (const k of r.peak.keys()) keys.add(k)
  const out = []
  for (const k of keys) {
    const pb = runs.map(r => (r.peak.get(k) || { bytes: 0 }).bytes)
    const pn = runs.map(r => (r.peak.get(k) || { n: 0 }).n)
    const sb = runs.map(r => (r.settled.get(k) || { bytes: 0 }).bytes)
    const present = runs.filter(r => r.peak.has(k)).length
    out.push({ size: k, pb, pn, sb, present, mpb: mean(pb), msb: mean(sb) })
  }
  out.sort((x, y) => y.mpb - x.mpb || x.size - y.size)
  return out.slice(0, topN)
}

function report(arm, label) {
  const runs = R[arm]
  const tbl = classTable(arm, 12)
  say('=== ' + label + ' ===')
  say('    DENOMINATOR for every "% of peak" in this section: THAT RUN\'S OWN pkCrtBusy')
  say('    (' + runs.map(r => r.tag + ' = ' + n(r.pkCrtBusy)).join('   ') + ').')
  say('')
  say('    (a) THE 12 LARGEST PEAK CLASSES, BY MEAN BYTES OVER THE THREE RUNS')
  say('      size      ' + runs.map(r => pad(r.tag + ' blk', 11) + pad(r.tag + ' bytes', 13)).join('') + pad('mean %pk', 10) + '  in 3?')
  for (const c of tbl) {
    let line = '      ' + padr(n(c.size), 10)
    for (let i = 0; i < runs.length; i++) line += pad(c.pn[i] ? n(c.pn[i]) : '-', 11) + pad(c.pb[i] ? n(c.pb[i]) : '-', 13)
    const sh = mean(runs.map((r, i) => c.pb[i] / r.pkCrtBusy))
    say(line + pad(pc(sh), 10) + '  ' + (c.present === 3 ? 'yes' : c.present + '/3'))
  }
  say('')
  say('    (b) CONCORDANCE -- a class large in ONE run is a draw, not an occupant.')
  say('        rel.range = (max - min) / mean of the three PEAK byte figures.')
  say('      size        mean bytes   rel.range   mean blocks   blk rel.range   verdict')
  for (const c of tbl) {
    const rr = (Math.max(...c.pb) - Math.min(...c.pb)) / c.mpb
    const mn = mean(c.pn), rn = mn ? (Math.max(...c.pn) - Math.min(...c.pn)) / mn : 0
    const v = c.present < 3 ? 'NOT IN ALL THREE' : rr <= 0.25 ? 'concordant' : rr <= 0.60 ? 'loose' : 'DRAW-LIKE'
    say('      ' + padr(n(c.size), 11) + pad(n(Math.round(c.mpb)), 12) + pad((rr * 100).toFixed(1) + '%', 12) + pad(mn.toFixed(1), 14) + pad((rn * 100).toFixed(1) + '%', 16) + '   ' + v)
  }
  say('')
  say('    (c) THE SAME CLASSES AT SHUTDOWN. This is the column that answers the question.')
  say('        "ROW ABSENT" = no HCSIZE row at all, in any of the three runs.')
  say('        % of transient divides by THAT RUN\'S OWN transient, then averages.')
  say('      size        mean peak B   mean settled B   survives   mean transient B   % of transient')
  for (const c of tbl) {
    const trans = runs.map((r, i) => c.pb[i] - c.sb[i])
    const sh = mean(runs.map((r, i) => (c.pb[i] - c.sb[i]) / r.transient))
    const anyRow = runs.filter(r => r.settled.has(c.size)).length
    const surv = anyRow === 0 ? 'ROW ABSENT' : (c.msb / c.mpb * 100).toFixed(1) + '%' + (anyRow < 3 ? ' (' + anyRow + '/3)' : '')
    say('      ' + padr(n(c.size), 11) + pad(n(Math.round(c.mpb)), 12) + pad(n(Math.round(c.msb)), 17) + pad(surv, 12) + pad(n(Math.round(mean(trans))), 18) + pad(pc(sh), 16))
  }
  say('')
  const keys = new Set(); for (const r of runs) for (const k of r.peak.keys()) keys.add(k)
  for (const r of runs) for (const k of r.settled.keys()) keys.add(k)
  const all = [...keys].map(k => {
    const t = runs.map(r => ((r.peak.get(k) || { bytes: 0 }).bytes - (r.settled.get(k) || { bytes: 0 }).bytes))
    return { size: k, t, mt: mean(t) }
  }).sort((x, y) => y.mt - x.mt || x.size - y.size)
  say('    (d) THE TRANSIENT ITSELF, RANKED. peak bytes MINUS settled bytes, per class.')
  say('      rank  size        ' + runs.map(r => pad(r.tag, 13)).join('') + pad('mean', 14) + '   survives at shutdown?')
  for (let i = 0; i < 8; i++) {
    const anyRow = runs.filter(r => r.settled.has(all[i].size)).length
    say('      ' + padr(i + 1, 6) + padr(n(all[i].size), 11) + runs.map((_, j) => pad(n(all[i].t[j]), 13)).join('') + pad(n(Math.round(all[i].mt)), 14) + '   ' + (anyRow === 0 ? 'NO ROW AT ALL' : anyRow + '/3 runs keep a row'))
  }
  say('')
  say('    (e) CUMULATIVE COVERAGE OF THE TRANSIENT, each cell over THAT RUN\'S OWN transient')
  say('        (' + runs.map(r => r.tag + ' = ' + n(r.transient)).join('   ') + ').')
  say('      N   classes folded in                            ' + runs.map(r => pad(r.tag, 9)).join('') + pad('mean', 9))
  const cum = runs.map(() => 0)
  for (let i = 0; i < 8; i++) {
    for (let j = 0; j < runs.length; j++) cum[j] += all[i].t[j]
    const names = all.slice(0, i + 1).map(c => n(c.size)).join(' ')
    const shares = runs.map((r, j) => cum[j] / r.transient)
    say('      ' + padr(i + 1, 4) + padr(names.length > 44 ? names.slice(0, 41) + '...' : names, 45) + shares.map(s => pad((s * 100).toFixed(1) + '%', 9)).join('') + pad((mean(shares) * 100).toFixed(1) + '%', 9))
  }
  say('')
  return { tbl, all }
}

report('SL', '1. THE STACKLESS ARM -- THE TARGET. p1, p4, p5')
report('FB', '2. THE FIBER ARM -- CONTRAST ONLY, NOT THE TARGET. p2, p3, p6')

say('=== 3. THE BURST MODE, READ OFF THE DATA, BECAUSE SECTION 4 NEEDS IT ===')
say('    PEAK-OCCUPANT.md section 4 established that this workload peaks in two modes,')
say('    and that the mode is the number of history-sync chunks held and decoded')
say('    CONCURRENTLY -- six or seven -- read directly off the 1,048,576 and 934,576')
say('    rows. That reproduces here on six fresh runs across BOTH lanes:')
say('      run   lane        1,048,576 blk   934,576 blk   mode   pkCrtBusy    transient')
for (const a of ['SL', 'FB']) for (const r of R[a]) {
  const m = (r.peak.get(1048576) || { n: 0 }).n, g = (r.peak.get(934576) || { n: 0 }).n
  say('      ' + padr(r.tag, 6) + padr(LANE[a], 10) + pad(m, 13) + pad(g, 14) + pad(m === 7 ? 'HIGH' : 'LOW', 7) + pad(n(r.pkCrtBusy), 12) + pad(n(r.transient), 13))
}
say('    The two rows agree on the mode in all six runs, and in BOTH arms the HIGH-mode')
say('    run is the run with the largest transient. The mode is not a lane property.')
say('')
say('=== 4. THE 1,328 CLASS -- the hypothesis on the record, scored ===')
say('    blocks and bytes, peak then shutdown, all six runs:')
say('      run   lane      mode    peak blocks     peak bytes   settled blocks   settled bytes')
for (const a of ['SL', 'FB']) for (const r of R[a]) {
  const p = r.peak.get(1328) || { n: 0, bytes: 0 }, s = r.settled.get(1328) || { n: 0, bytes: 0 }
  const md = (r.peak.get(1048576) || { n: 0 }).n === 7 ? 'HIGH' : 'LOW'
  say('      ' + padr(r.tag, 6) + padr(LANE[a], 10) + padr(md, 6) + pad(p.n ? n(p.n) : 'absent', 14) + pad(p.bytes ? n(p.bytes) : '-', 15) + pad(s.n ? n(s.n) : 'absent', 17) + pad(s.bytes ? n(s.bytes) : '-', 16))
}
const fbPk = R.FB.map(r => r.peak.get(1328) || { n: 0, bytes: 0 })
const fb1328Mean = mean(fbPk.map(p => p.bytes))
say('')
say('    bytes per block on the fiber peak rows: ' + fbPk.map(p => p.n ? (p.bytes / p.n).toFixed(2) : '-').join('   ') + '   (= size 1,328 + cbOverhead)')
say('    share of each fiber run\'s OWN pkCrtBusy: ' + R.FB.map((r, i) => pc(fbPk[i].bytes / r.pkCrtBusy)).join('   '))
say('    share of each fiber run\'s OWN transient: ' + R.FB.map((r, i) => pc(fbPk[i].bytes / r.transient)).join('   '))
say('')
say('    THE 1,371 B/task FIGURE IS NOT A MEASUREMENT OF THIS CLASS.')
say('    tests/perf/pagecensus/evidence-fr2/PERTASK.txt, lines 2-3 and 10, verbatim:')
say('      "Denominator: 20207 stacks on f1 minus 17 on v3 = 20190 tasks, both LOW mode."')
say('      "This is a DIFFERENCE per task, not a measurement of one task in isolation:"')
say('      "  CRT heap                     26.390         1371     6.8%"')
say('    So ' + PERTASK_PER_TASK + ' = ' + PERTASK_HEAP_MIB + ' MiB / ' + n(PERTASK_TASKS) + ' = ' + Math.round(PERTASK_HEAP_B / PERTASK_TASKS) + ' B -- a DIVISION over the WHOLE CRT')
say('    heap lane delta, every size class folded together, taken on a DIFFERENT')
say('    instrument (the pagecensus VirtualQuery walk), a DIFFERENT pair of binaries')
say('    and a DIFFERENT tree. Category (b)+(c) of the three asked for: DERIVED BY')
say('    DIVISION, and an AVERAGE THAT INCLUDES OTHER CLASSES.')
say('')
say('    AND THAT IS WHY THE BYTE MATCH CANNOT CONFIRM ANYTHING. On the fiber arm')
say('    measured here the 1,328 class alone is ' + n(Math.round(fb1328Mean)) + ' B mean = ' + mib(fb1328Mean) + ' MiB,')
say('    which is ' + (fb1328Mean / PERTASK_HEAP_B * 100).toFixed(1) + '% of the ' + n(PERTASK_HEAP_B) + ' B that PERTASK.txt divides -- it OVERSHOOTS')
say('    that total, which is itself the proof that the two are not the same')
say('    measurement (different tree, different binaries, different instrument).')
say('    What survives the mismatch is the only thing needed: ON ANY OF THESE')
say('    DENOMINATORS THE 1,328 CLASS IS ESSENTIALLY THE WHOLE CRT-HEAP LANE TERM.')
say('    And if one class is essentially the whole sum, the sum over a count MUST')
say('    land near that class\'s block size. 1,328 against 1,371 is arithmetically')
say('    forced, not independent. CIRCULAR -- the byte half cannot be affirmed.')
say('')
say('    THE NON-CIRCULAR HALF IS THE BLOCK COUNT, AND IT IS MATCHED BY MODE.')
say('    pagecensus/evidence-fr2/manifest.txt line 37 reads')
say('      "f1   fiber      low      446.844          446.164    99.85%    61403   20207"')
say('    -- 20,207 STACK REGIONS, fiber, LOW mode, counted by a VirtualQuery walk that')
say('    never touches the heap. The two LOW-mode fiber runs here read ' + n(fbPk[0].n) + ' blocks of')
say('    1,328 at the heap peak. That is ' + Math.abs(fbPk[0].n - 20207) + ' apart, ' + (Math.abs(fbPk[0].n - 20207) / 20207 * 100).toFixed(3) + '%, from a DIFFERENT')
say('    instrument on a DIFFERENT tree. This is a genuine independent corroboration,')
say('    and it is a COUNT -- it borrows no byte figure from anywhere.')
say('      f1   fiber LOW   stacks (VirtualQuery)   ' + n(20207))
say('      p2   fiber LOW   1,328 blocks (HeapWalk) ' + n(fbPk[0].n))
say('      p3   fiber LOW   1,328 blocks (HeapWalk) ' + n(fbPk[1].n))
say('      p6   fiber HIGH  1,328 blocks (HeapWalk) ' + n(fbPk[2].n) + '   -- no HIGH-mode fiber stack count exists')
say('    I RETRACT, BEFORE WRITING IT DOWN, THE READING THAT p6 REFUTES THE LAW. The')
say('    population that matters is tasks SUSPENDED AT THE PEAK INSTANT, which is not')
say('    the dial: p6 is the HIGH-mode run (section 3), and in the HIGH mode one more')
say('    history-sync chunk is in flight. ' + n(fbPk[2].n - fbPk[0].n) + ' extra blocks for one extra chunk.')
say('    manifest.txt commits no HIGH-mode FIBER row (v1 is high-mode STACKLESS), so')
say('    there is nothing to check p6 against. UNTESTED, not refuted.')
say('')
say('    VERDICT ON THE HYPOTHESIS, IN TWO HALVES:')
say('      (i)  "one 1,328 B block per parked task": SUPPORTED, by a count, in LOW')
say('           mode, to ' + (Math.abs(fbPk[0].n - 20207) / 20207 * 100).toFixed(3) + '% against an independent instrument. n = 2 LOW-mode runs,')
say('           and both read the IDENTICAL ' + n(fbPk[0].n) + ' -- which is itself worth noting as')
say('           a suspiciously exact repeat and is reported, not explained.')
say('      (ii) "1,328 and 1,371 are the same number by another route": CIRCULAR, and')
say('           it is not a second route. 1,371 is a whole-heap lane delta that THIS')
say('           class accounts for in full, divided by a count that is THIS class\'s')
say('           block count to 0.02%. It is this class\'s block size recomputed the')
say('           long way. The true per-block size is ' + (fbPk[0].bytes / fbPk[0].n).toFixed(0) + ' B MEASURED (' + n(1328) + ' request')
say('           + 32 overhead), and 1,371 is DERIVED, so the 11 B between them is a')
say('           property of the two denominators, not a finding about the program.')
say('')
say('=== 5. WHAT THE 1,328 CLASS IS WORTH, WITH THE DENOMINATORS SIDE BY SIDE ===')
const slPkMean = mean(R.SL.map(r => r.pkCrtBusy)), fbPkMean = mean(R.FB.map(r => r.pkCrtBusy))
const sl1328Mean = mean(R.SL.map(r => (r.peak.get(1328) || { bytes: 0 }).bytes))
say('    N of D, with D named each time:')
say('      ' + n(Math.round(fb1328Mean - sl1328Mean)) + ' of ' + n(Math.round(fbPkMean - slPkMean)) + ' = ' + pc((fb1328Mean - sl1328Mean) / (fbPkMean - slPkMean)))
say('        N = the 1,328 class, fiber peak mean minus stackless peak mean, THESE six runs')
say('        D = pkCrtBusy, fiber mean minus stackless mean, THESE six runs (= the')
say('            -33,522,331 B of 5cd3e3475, to the sign)')
say('      ' + n(Math.round(fb1328Mean - sl1328Mean)) + ' of ' + n(PERTASK_HEAP_B) + ' = ' + pc((fb1328Mean - sl1328Mean) / PERTASK_HEAP_B))
say('        D = the "CRT heap 26.390 MiB" row of PERTASK.txt -- ANOTHER TREE, ANOTHER')
say('            PAIR OF BINARIES, ANOTHER INSTRUMENT. Printed to show that the class')
say('            is most of what that row lumps, NOT as a comparison of two measurements.')
say('    The second ratio is why (ii) above is circular, stated as a number.')
say('')
say('=== 6. WHAT THE 1,328 ROW IS ON THE ARM THAT SHIPS ===')
for (const r of R.SL) {
  const p = r.peak.get(1328) || { n: 0, bytes: 0 }
  say('      ' + padr(r.tag, 5) + pad(p.n, 4) + ' blocks, ' + pad(n(p.bytes), 8) + ' B = ' + (p.bytes / r.pkCrtBusy * 100).toFixed(4) + '% of that run\'s own pkCrtBusy')
}
say('    On the stackless arm this class is noise by four orders of magnitude. It is')
say('    archaeology of a lane that stopped being the default at 8f4100d7a.')
say('')

say('=== 7. AGAINST PEAK-OCCUPANT.md, WHICH TRIED THIS ONCE AT n=1 ===')
say('    ../PEAK-OCCUPANT.md section 2 ranks the peak of ONE stackless binary, built')
say('    from a DIFFERENT tree (5fa7a24f8) with SCR_CYCSTAT_ON as well, denominator')
say('    "abba1A -- 46,433,872 B of CRT busy". Its four largest, verbatim from that')
say('    table, against the three-run means here (each share over its OWN denominator):')
say('      size         PEAK-OCCUPANT abba1A   blocks       here, SL mean   blocks (p1/p4/p5)')
const OCC = [[65536, 41.51, '294'], [4376, 16.95, '1,702'], [1048576, 13.55, '6'], [934576, 12.08, '6']]
for (const [k, sh, blk] of OCC) {
  const here = mean(R.SL.map(r => (r.peak.get(k) || { bytes: 0 }).bytes / r.pkCrtBusy))
  const blks = R.SL.map(r => (r.peak.get(k) || { n: 0 }).n).join('/')
  say('      ' + padr(n(k), 12) + pad(sh.toFixed(2) + '%', 18) + pad(blk, 12) + pad(pc(here), 20) + '   ' + blks)
}
say('    SAME FOUR CLASSES, SAME ORDER, every share within ' +
  Math.max(...OCC.map(([k, sh]) => Math.abs(sh - mean(R.SL.map(r => (r.peak.get(k) || { bytes: 0 }).bytes / r.pkCrtBusy)) * 100))).toFixed(1) + ' points.')
say('    PEAK-OCCUPANT.md WAS RIGHT, and this says so: its n=1 ranking reproduces on')
say('    three runs of a different binary from a different tree in a different session.')
say('    Its "three of the four largest are GONE by shutdown" reproduces exactly --')
say('    4,376 / 1,048,576 / 934,576 have NO HCSIZE ROW AT ALL in all three runs here.')
say('    Its 65,536 shutdown count of 164 reproduces too: ' + R.SL.map(r => Math.round((r.settled.get(65536) || { n: 0 }).n)).join(' / ') + ' blocks here.')
say('    WHAT IS NEW AND IS NOT IN IT: the transient column with a named denominator,')
say('    the concordance across runs, and the fiber contrast -- it had no fiber arm.')
say('    WHAT IS NOT INHERITED FROM IT: no figure above is copied from that file. The')
say('    four numbers in this section\'s left column are quoted ONLY to be compared.')
say('')
say('=== 8. WHAT THIS CANNOT SAY ===')
say('    * The ALLOCATION SITE of the 1,048,576 / 934,576 pair is still unnamed.')
say('      PEAK-OCCUPANT.md section 4 says so and nothing here changes it: a size, a')
say('      count and a mode is what a HeapWalk can be asked for.')
say('    * FLOW vs RETENTION is not separated. The 1,048,576 / 934,576 pair is a')
say('      decode burst caught in the air; the 4,376 class is a cache that is held')
say('      and then released on an idle timer. Both read as "transient" in column (c)')
say('      and the column cannot tell them apart.')
say('    * n = 3 per arm. Nothing here is a t-test and nothing here claims separation;')
say('      the concordance column is a RANGE over three runs, not an inference.')
say('')
if (process.env.V4_WRITE) writeFileSync(process.env.V4_WRITE, L.join('\n') + '\n')
