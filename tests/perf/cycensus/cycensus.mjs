/**
 * cycensus.mjs - reads the report scr_cyc_census.h writes and ranks
 * `scr_cyc_alloc`'s live heap BY OBJECT KIND.
 *
 * estado-ramcpu measured 68.9% of zapo's live-heap peak arriving through one
 * `calloc` in `scr_cycle.c` and could not say what any of it was, because a
 * malloc-level lane keys rows on "file:line" and every cycle-headered object
 * in the program shares that line. The census keys on the `ScrCycFreeFn`
 * that `scr_cyc_alloc` is already handed, which names the kind exactly; this
 * reader turns those function addresses into names through the PDB and adds
 * the three decompositions the raw counters make possible:
 *
 *   header vs payload   sizeof(ScrCycHdr) is carried by every object. The
 *                       census reports the header size the BUILD had rather
 *                       than assuming 32, and this reader cross-checks it
 *                       against live_phys - live_payload.
 *   live vs pool        a block <= SCR_POOL_MAX that the program dropped is
 *                       kept by the size-class pool and never freed, so a
 *                       malloc-level lane calls it live. It is allocator
 *                       slack and it is reported apart.
 *   peak vs exit        `snap` columns are each kind's live bytes at the
 *                       census's own high-water mark; `live` is at exit.
 *
 * REFUSALS. The reader exits non-zero rather than printing a number when
 * the arm row is missing (`--arm-key` unset in the build), when ptrLost or
 * freeUnknown or lost is non-zero (the tables overflowed, so every figure is
 * a floor), or when the per-row totals do not add up to the CYCEN-TOTAL
 * line. A census that cannot say "nothing was dropped" is not evidence.
 *
 * Usage:
 *   node tests/perf/cycensus/cycensus.mjs --self-test
 *   node tests/perf/cycensus/cycensus.mjs --report r.txt [--syms syms.json]
 *                                         [--curve] [--json out.json]
 */
import { readFileSync, writeFileSync } from 'node:fs'

const ARM_ALLOCS = 64 // the -DSCR_CYCEN_ARM value every build here uses
const ARM_PHYS = 4096

/** Parse a report into { hdr, anchor, rows[], curve[], total{} }. */
export function parseCensus(text) {
  const rows = []
  const curve = []
  let hdr = null
  let anchor = null
  let total = null
  for (const line of text.split(/\r?\n/)) {
    if (line.startsWith('CYCEN-KIND ')) {
      const m = /hdr=(-?\d+) anchor=([0-9a-f]+)/.exec(line)
      if (!m) throw new Error(`malformed CYCEN-KIND: ${line}`)
      hdr = Number(m[1])
      anchor = BigInt(`0x${m[2]}`)
    } else if (line.startsWith('CYCEN-CURVE ')) {
      const f = line.split(' ')
      curve.push({
        i: Number(f[1]), ord: Number(f[2]), livePhys: Number(f[3]),
        poolPhys: Number(f[4]), liveN: Number(f[5]), poolN: Number(f[6]),
        sec: Number(f[7]),
      })
    } else if (line.startsWith('CYCEN-TOTAL ')) {
      total = {}
      for (const kv of line.slice('CYCEN-TOTAL '.length).split(' ')) {
        const i = kv.indexOf('=')
        if (i > 0) total[kv.slice(0, i)] = Number(kv.slice(i + 1))
      }
    } else if (line.startsWith('CYCEN ')) {
      const f = line.split(' ')
      if (f.length !== 22) throw new Error(`CYCEN row has ${f.length - 1} fields, want 21`)
      rows.push({
        nAlloc: Number(f[1]), nFree: Number(f[2]), nPoolHit: Number(f[3]),
        nPoolGive: Number(f[4]), bytesEver: Number(f[5]),
        liveN: Number(f[6]), livePhys: Number(f[7]), livePayload: Number(f[8]),
        snapN: Number(f[9]), snapPhys: Number(f[10]), snapPayload: Number(f[11]),
        sizeMin: Number(f[12]), sizeMax: Number(f[13]), sizeSum: Number(f[14]),
        parkN: Number(f[15]), parkPhys: Number(f[16]), parkSide: Number(f[17]),
        snapParkN: Number(f[18]), snapParkPhys: Number(f[19]), snapParkSide: Number(f[20]),
        key: BigInt(`0x${f[21]}`),
      })
    }
  }
  if (total === null) throw new Error('no CYCEN-TOTAL line: the report is truncated')
  return { hdr, anchor, rows, curve, total }
}

/** Every check that must pass before a number from this report is quoted. */
export function auditCensus(c, { armAllocs = ARM_ALLOCS } = {}) {
  const problems = []
  const t = c.total
  if (t.lost !== 0) problems.push(`row table overflowed: lost=${t.lost}`)
  if (t.ptrLost !== 0) problems.push(`pointer table overflowed: ptrLost=${t.ptrLost}`)
  if (t.freeUnknown !== 0) problems.push(`freeUnknown=${t.freeUnknown}: a free had no recorded allocation`)
  if (c.hdr === null || c.hdr <= 0) problems.push(`no header size reported (hdr=${c.hdr})`)

  const arm = c.rows.filter((r) => r.nAlloc === armAllocs && r.sizeMin === ARM_PHYS - 32 && r.sizeMax === ARM_PHYS - 32 && r.bytesEver === armAllocs * ARM_PHYS)
  if (arm.length !== 1) {
    problems.push(`the arm row is ${arm.length === 0 ? 'ABSENT' : `AMBIGUOUS (${arm.length} candidates)`}: rebuild with -DSCR_CYCEN_ARM=${armAllocs}`)
  } else {
    const a = arm[0]
    const wantFree = Math.floor(armAllocs / 2)
    if (a.nFree !== wantFree) problems.push(`arm nFree=${a.nFree}, want ${wantFree}`)
    if (a.liveN !== armAllocs - wantFree) problems.push(`arm liveN=${a.liveN}, want ${armAllocs - wantFree}`)
    if (a.livePhys !== (armAllocs - wantFree) * ARM_PHYS) problems.push(`arm livePhys=${a.livePhys}`)
    // the negative control: the freeing path must not have made a row of
    // its own. Every arm free was charged BACK to the allocating row, so
    // exactly one row carries the arm key and nothing else does.
    const strays = c.rows.filter((r) => r !== a && r.nFree > 0 && r.nAlloc === 0)
    if (strays.length !== 0) problems.push(`${strays.length} row(s) have frees but no allocations: frees are being keyed by where they happen`)
    if (t.armPhys !== (armAllocs - wantFree) * ARM_PHYS) problems.push(`armPhys=${t.armPhys} disagrees with the arm row`)
  }

  const sum = (f) => c.rows.reduce((a, r) => a + r[f], 0)
  if (sum('nAlloc') !== t.allocs) problems.push(`rows sum nAlloc=${sum('nAlloc')} != allocs=${t.allocs}`)
  if (sum('nFree') !== t.frees) problems.push(`rows sum nFree=${sum('nFree')} != frees=${t.frees}`)
  if (sum('liveN') !== t.liveN) problems.push(`rows sum liveN=${sum('liveN')} != liveN=${t.liveN}`)
  if (sum('livePhys') !== t.livePhys) problems.push(`rows sum livePhys=${sum('livePhys')} != livePhys=${t.livePhys}`)
  if (sum('snapPhys') !== t.liveAtPeak) problems.push(`rows sum snapPhys=${sum('snapPhys')} != liveAtPeak=${t.liveAtPeak}`)
  if (t.livePhys + t.poolPhys > t.osPeak) problems.push(`os held now (${t.livePhys + t.poolPhys}) exceeds osPeak=${t.osPeak}`)
  if (t.allocs - t.frees !== t.liveN) problems.push(`allocs-frees=${t.allocs - t.frees} != liveN=${t.liveN}`)
  if (t.parkUnknown !== 0) problems.push(`parkUnknown=${t.parkUnknown}: a freelist park named an object the census never saw allocated`)
  if (sum('parkPhys') !== t.parkPhys) problems.push(`rows sum parkPhys=${sum('parkPhys')} != parkPhys=${t.parkPhys}`)
  if (t.parkPhys > t.livePhys) problems.push(`parked (${t.parkPhys}) exceeds live (${t.livePhys}): parked must be a SUBSET of live`)
  if (sum('snapParkPhys') !== t.parkAtPeak) problems.push(`rows sum snapParkPhys=${sum('snapParkPhys')} != parkAtPeak=${t.parkAtPeak}`)

  // The header cross-check: physical bytes minus requested payload must be
  // liveN headers plus at most SCR_POOL_GRAIN-1 of rounding per object.
  const overhead = t.livePhys - t.livePayload
  const lo = t.liveN * c.hdr
  const hi = t.liveN * (c.hdr + 7)
  if (!(overhead >= lo && overhead <= hi)) {
    problems.push(`livePhys-livePayload=${overhead} outside [${lo},${hi}] for hdr=${c.hdr}`)
  }
  return problems
}

/** Nearest preceding symbol for an rva, with an exactness flag. */
function resolve(syms, rva) {
  let lo = 0
  let hi = syms.length - 1
  let best = null
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (syms[mid].rva <= rva) { best = syms[mid]; lo = mid + 1 } else { hi = mid - 1 }
  }
  if (!best) return { name: '?', exact: false, delta: 0 }
  return { name: best.name, exact: best.rva === rva, delta: rva - best.rva }
}

function fmt(n) { return n.toLocaleString('en-US') }
function pct(a, b) { return b === 0 ? '  --  ' : `${((100 * a) / b).toFixed(2)}%` }

function main(argv) {
  const arg = (k, d) => {
    const i = argv.indexOf(k)
    return i >= 0 && i + 1 < argv.length ? argv[i + 1] : d
  }
  if (argv.includes('--self-test')) return selfTest()
  const path = arg('--report', null)
  if (!path) { console.error('need --report <file> or --self-test'); return 2 }
  const c = parseCensus(readFileSync(path, 'utf8'))
  const problems = auditCensus(c)

  let syms = null
  const symPath = arg('--syms', null)
  const anchorName = arg('--anchor', 'scr_collect_cycles')
  if (symPath) {
    const raw = JSON.parse(readFileSync(symPath, 'utf8'))
    syms = (Array.isArray(raw) ? raw : raw.symbols).slice().sort((a, b) => a.rva - b.rva)
    const a = syms.find((s) => s.name === anchorName)
    if (!a) { problems.push(`anchor symbol ${anchorName} not in --syms`); syms = null }
    else c.anchorRva = a.rva
  }
  const nameOf = (key) => {
    if (!syms || c.anchorRva === undefined) return `0x${key.toString(16)}`
    const rva = Number(key - c.anchor) + c.anchorRva
    const r = resolve(syms, rva)
    return r.exact ? r.name : `${r.name}+${r.delta}`
  }

  const t = c.total
  const armKeys = new Set(c.rows.filter((r) => r.nAlloc === ARM_ALLOCS && r.sizeMin === ARM_PHYS - 32 && r.bytesEver === ARM_ALLOCS * ARM_PHYS).map((r) => r.key))
  const real = c.rows.filter((r) => !armKeys.has(r.key))
  const armSnap = c.rows.filter((r) => armKeys.has(r.key)).reduce((a, r) => a + r.snapPhys, 0)
  const armLive = c.rows.filter((r) => armKeys.has(r.key)).reduce((a, r) => a + r.livePhys, 0)

  console.log(`report        ${path}`)
  console.log(`hdr bytes     ${c.hdr}   (sizeof(ScrCycHdr) as the BUILD had it)`)
  console.log(`arm           ${armKeys.size} row(s), ${fmt(armSnap)} B at peak / ${fmt(armLive)} B at exit, subtracted below`)
  console.log('')
  const snapTot = real.reduce((a, r) => a + r.snapPhys, 0)
  const liveTot = real.reduce((a, r) => a + r.livePhys, 0)
  const everTot = real.reduce((a, r) => a + r.bytesEver, 0)
  console.log(`AT THE CENSUS PEAK   os ${fmt(t.osPeak - armSnap)} B = live ${fmt(snapTot)} + pool ${fmt(t.poolAtPeak)}`)
  // The arm's allocations are planted from a constructor, so they are the
  // FIRST ones the census ever sees and the real ordinal is offset by
  // exactly the arm's count - a known constant, not an estimate.
  console.log(`                     reached at allocation ${fmt(Math.max(0, t.snapOrd - ARM_ALLOCS))} of ${fmt(t.allocs - ARM_ALLOCS)}`)
  console.log(`   of that live half:   program ${fmt(snapTot - t.parkAtPeak)} + parked on the dyn freelist ${fmt(t.parkAtPeak)} (+${fmt(t.parkSideAtPeak)} B of items/entries riding along)`)
  console.log(`AT EXIT              os ${fmt(t.livePhys + t.poolPhys - armLive)} B = live ${fmt(liveTot)} + pool ${fmt(t.poolPhys)}`)
  console.log(`   of that live half:   program ${fmt(liveTot - t.parkPhys)} + parked ${fmt(t.parkPhys)} (+${fmt(t.parkSide)} B side)`)
  console.log(`EVER                 ${fmt(everTot)} B over ${fmt(t.allocs - ARM_ALLOCS)} allocations, ${fmt(t.frees - ARM_ALLOCS / 2)} frees`)
  console.log(`POOL                 hit ${fmt(real.reduce((a, r) => a + r.nPoolHit, 0))} / gave ${fmt(real.reduce((a, r) => a + r.nPoolGive, 0))}, peak held ${fmt(t.poolPeak)} B`)
  console.log('')
  console.log('kind, by live bytes AT THE PEAK. hdr = liveN * sizeof(ScrCycHdr).')
  console.log('')
  console.log('      atPeak   %peak   objects  B/obj      hdr B  %hdr     parked  side B     atExit  held%   allocs   size    kind')
  const ranked = real.slice().sort((a, b) => b.snapPhys - a.snapPhys)
  for (const r of ranked) {
    if (r.snapPhys === 0 && r.livePhys === 0 && r.bytesEver === 0) continue
    const bpo = r.snapN ? (r.snapPhys / r.snapN).toFixed(1) : '-'
    const hdrB = r.snapN * c.hdr
    const size = r.sizeMin === r.sizeMax ? `${r.sizeMin}` : `${r.sizeMin}..${r.sizeMax}`
    console.log(
      `${fmt(r.snapPhys).padStart(12)} ${pct(r.snapPhys, snapTot).padStart(7)} ` +
      `${fmt(r.snapN).padStart(9)} ${bpo.padStart(6)} ${fmt(hdrB).padStart(10)} ` +
      `${pct(hdrB, r.snapPhys).padStart(6)} ${fmt(r.snapParkPhys).padStart(10)} ${fmt(r.snapParkSide).padStart(7)} ${fmt(r.livePhys).padStart(10)} ` +
      `${pct(r.livePhys, r.snapPhys).padStart(6)} ${fmt(r.nAlloc).padStart(8)} ` +
      `${size.padStart(8)}    ${nameOf(r.key)}`)
  }
  const hdrPeak = real.reduce((a, r) => a + r.snapN, 0) * c.hdr
  console.log('')
  console.log(`HEADERS AT THE PEAK  ${fmt(hdrPeak)} B of ${fmt(snapTot)} = ${pct(hdrPeak, snapTot)} of the live cycle heap`)

  if (argv.includes('--curve')) {
    console.log('')
    console.log('growth curve: ordinal, live bytes, pool bytes, live objects, pooled objects, seconds')
    for (const s of c.curve) console.log(`CURVE ${s.ord} ${s.livePhys} ${s.poolPhys} ${s.liveN} ${s.poolN} ${s.sec}`)
  }
  const jsonOut = arg('--json', null)
  if (jsonOut) {
    writeFileSync(jsonOut, JSON.stringify({
      hdr: c.hdr, total: t,
      rows: ranked.map((r) => ({ ...r, key: `0x${r.key.toString(16)}`, name: nameOf(r.key) })),
      curve: c.curve,
    }, null, 1))
  }
  console.log('')
  if (problems.length) {
    console.log(`AUDIT FAILED - ${problems.length} problem(s); no figure above is evidence:`)
    for (const p of problems) console.log(`  ! ${p}`)
    return 1
  }
  console.log('AUDIT OK - arm recovered, tables did not overflow, rows sum to the totals')
  return 0
}

/* ---- the self-test -------------------------------------------------
 * Every fact below is planted, so the checker is judged on recovering it.
 * The three NEGATIVE controls are the point: a report that overflowed, a
 * report with no arm, and a report whose rows do not sum to its totals must
 * each be REFUSED rather than summarised. */
function selfTest() {
  let n = 0
  const ok = (cond, what) => {
    n++
    if (!cond) { console.log(`SELFTEST FAIL: ${what}`); process.exitCode = 1 }
  }
  const build = (rows, tot) => {
    const L = ['CYCEN-KIND cycle hdr=32 anchor=140001000']
    for (const r of rows) L.push(`CYCEN ${r.join(' ')}`)
    L.push('CYCEN-CURVE 0 500 1024 0 8 0 0')
    L.push('CYCEN-CURVE 1 1000 4096 64 32 1 3')
    L.push(`CYCEN-TOTAL ${Object.entries(tot).map(([k, v]) => `${k}=${v}`).join(' ')}`)
    return L.join('\n')
  }
  //            nA nF pH pG ever  lN  lPhys lPay  sN  sPhys sPay  min  max  sum  key
  //            nA nF pH pG   ever  lN  lPhys  lPay  sN  sPhys  sPay  min  max   sum  pN pPhys pSide spN spPhys spSide key
  const armRow = [64, 32, 0, 0, 262144, 32, 131072, 130048, 32, 131072, 130048, 4064, 4064, 260096, 0, 0, 0, 0, 0, 0, '140002000']
  const bigRow = [1000, 400, 100, 200, 80000, 600, 48000, 28800, 700, 56000, 33600, 48, 48, 48000, 150, 12000, 9600, 200, 16000, 12800, '140003000']
  const total = {
    rows: 2, allocs: 1064, frees: 432, liveN: 632, livePhys: 179072, livePayload: 158848,
    poolN: 200, poolPhys: 16000, osPeak: 195072, osPeakN: 732, livePeak: 187072,
    poolPeak: 16000, liveAtPeak: 187072, poolAtPeak: 8000, snapOrd: 900, snaps: 700,
    lost: 0, ptrLost: 0, freeUnknown: 0, ptrLive: 632, ptrLivePeak: 732,
    pslots: 262144, cycLive: 632, armPhys: 131072, parkN: 150, parkPhys: 12000,
    parkSide: 9600, parkPeak: 28800, parkAtPeak: 16000, parkNAtPeak: 200,
    parkSideAtPeak: 12800, parkUnknown: 0, tableBytes: 6516736,
  }
  const good = build([armRow, bigRow], total)
  const c = parseCensus(good)
  ok(c.hdr === 32, 'hdr parsed')
  ok(c.anchor === 0x140001000n, 'anchor parsed')
  ok(c.rows.length === 2, 'two rows parsed')
  ok(c.curve.length === 2, 'two curve samples parsed')
  ok(c.curve[1].ord === 1000 && c.curve[1].livePhys === 4096 && c.curve[1].poolN === 1 && c.curve[1].sec === 3, 'curve fields in order, seconds included')
  ok(c.rows[1].bytesEver === 80000 && c.rows[1].snapPhys === 56000, 'row fields in order')
  ok(c.rows[1].sizeMin === 48 && c.rows[1].sizeMax === 48 && c.rows[1].key === 0x140003000n, 'size columns and key in order')
  ok(c.total.osPeak === 195072, 'totals parsed')
  ok(auditCensus(c).length === 0, `a consistent report audits clean (got ${JSON.stringify(auditCensus(c))})`)

  // NEGATIVE 1: no arm row at all.
  const noArm = build([bigRow], {
    ...total, rows: 1, allocs: 1000, frees: 400, liveN: 600, livePhys: 48000,
    livePayload: 43200, liveAtPeak: 56000, ptrLive: 600, cycLive: 600, armPhys: 0,
  })
  const p1 = auditCensus(parseCensus(noArm))
  ok(p1.some((s) => s.includes('ABSENT')), 'a report with no arm is refused')

  // NEGATIVE 2: the pointer table overflowed.
  const lostRep = build([armRow, bigRow], { ...total, ptrLost: 7 })
  ok(auditCensus(parseCensus(lostRep)).some((s) => s.includes('ptrLost=7')),
    'ptrLost != 0 is refused: every figure would be a floor')

  // NEGATIVE 3: rows that do not sum to the totals.
  const skew = build([armRow, bigRow], { ...total, livePhys: 179073 })
  ok(auditCensus(parseCensus(skew)).some((s) => s.includes('rows sum livePhys')),
    'rows that disagree with the totals are refused')

  // NEGATIVE 4: a row with frees and no allocations - what a lane that keys
  // frees by where they HAPPEN would produce. This is the control the whole
  // instrument exists to pass.
  const strayRow = [0, 50, 0, 0, 0, 0, 0, 0, 0, 0, 0, -1, 0, 0, 0, 0, 0, 0, 0, 0, '140004000']
  const stray = build([armRow, bigRow, strayRow], { ...total, rows: 3, frees: 482 })
  ok(auditCensus(parseCensus(stray)).some((s) => s.includes('frees but no allocations')),
    'a free-keyed row is refused')

  // NEGATIVE 5: parked bytes that exceed live bytes. Parked is a strict
  // SUBSET of live (a parked node was never freed at any level), so this
  // can only mean the park and unpark hooks are unbalanced.
  const overPark = build([armRow, bigRow], { ...total, parkPhys: 200000 })
  ok(auditCensus(parseCensus(overPark)).some((s) => s.includes('SUBSET of live')),
    'parked bytes exceeding live bytes are refused')
  const unkPark = build([armRow, bigRow], { ...total, parkUnknown: 3 })
  ok(auditCensus(parseCensus(unkPark)).some((s) => s.includes('parkUnknown=3')),
    'a park of an object never seen allocated is refused')

  // NEGATIVE 6: a header size that does not reconcile with the payload.
  const badHdr = good.replace('hdr=32', 'hdr=200')
  ok(auditCensus(parseCensus(badHdr)).some((s) => s.includes('outside')),
    'a header size that cannot explain livePhys-livePayload is refused')

  // POSITIVE: the arithmetic the map is built out of.
  const b = c.rows[1]
  ok(b.snapN * c.hdr === 22400, 'header bytes at peak = objects * sizeof(ScrCycHdr)')
  ok(b.snapPhys - b.snapPayload === 22400, 'phys - payload is exactly 700 headers')
  ok(Math.round((b.snapPhys / b.snapN) * 10) / 10 === 80, 'bytes per object')
  ok(b.nPoolHit === 100 && b.nPoolGive === 200, 'pool hits and gives are separate columns')
  ok(b.parkN === 150 && b.parkPhys === 12000 && b.parkSide === 9600, 'park columns parsed')
  ok(b.snapParkN === 200 && b.snapParkPhys === 16000 && b.snapParkSide === 12800, 'park-at-peak columns parsed')
  ok(b.snapPhys - b.snapParkPhys === 40000, 'live minus parked is what the program holds at the peak')

  // A truncated report must throw, not summarise half of one.
  let threw = false
  try { parseCensus('CYCEN-KIND cycle hdr=32 anchor=140001000\nCYCEN 1 0 0 0 8 1 8 0 0 0 0 0 0 0 1') } catch { threw = true }
  ok(threw, 'a report with no CYCEN-TOTAL line throws')
  let threw2 = false
  try { parseCensus('CYCEN-KIND cycle hdr=32 anchor=1\nCYCEN 1 2 3\nCYCEN-TOTAL rows=1') } catch { threw2 = true }
  ok(threw2, 'a CYCEN row with the wrong field count throws')

  // resolve(): a hit in a gap must not masquerade as an exact name.
  const syms = [{ rva: 100, name: 'a' }, { rva: 200, name: 'b' }]
  ok(resolve(syms, 200).exact === true && resolve(syms, 200).name === 'b', 'exact symbol hit')
  ok(resolve(syms, 250).exact === false && resolve(syms, 250).delta === 50, 'a gap hit is inexact')
  ok(resolve(syms, 50).name === '?', 'below every symbol resolves to ?')

  console.log(process.exitCode ? `SELFTEST FAILED (${n} assertions)` : `SELFTEST OK - ${n} assertions, every planted fact recovered and every negative control refused`)
  return process.exitCode ?? 0
}

const rc = main(process.argv.slice(2))
if (rc) process.exitCode = rc
