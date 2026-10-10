/**
 * phase.mjs — is the startup cohort separable as an ALLOCATOR POLICY, or is
 * "90% born in the first 0.25%" a censored statistic that says less than it
 * looks?
 *
 *   node phase.mjs --life <tag>.life.txt [--blocks <tag>.life.txt.blocks]
 *
 * WHAT `segregate.mjs` LEFT OPEN.  It scored KIND and SITE and both lost to
 * MIXING: routing `scr_dyn_gcfree` out empties 9 of 111 non-empty chunks
 * while its own arena needs 54.  A chunk's contents, though, are decided when
 * it is CARVED, not by what the object is — so a key the allocator can read
 * for free and that cannot mix is BIRTH TIME.  `README.md` reports the
 * pinners' ages and reads a startup cohort off them.  This file tests the
 * policy that would follow.
 *
 * THE STATISTIC THAT READING RESTS ON IS CENSORED, AND THIS FILE UNCENSORS
 * IT.  "90% of the survivors were born in the first 92,182 allocations" is a
 * distribution over SURVIVORS.  The number a policy needs is the other
 * conditional — of everything BORN in that window, what fraction survived —
 * and `README.md` does not report it.  A window that allocates a million
 * objects and keeps 65,000 of them would strand a boot arena exactly the way
 * a type key strands the mixed one.
 *
 * THE DENOMINATOR IS FREE, AND THAT IS THE WHOLE TRICK.  `scr_life_seq` is
 * bumped once per cycle allocation and the birth stamped on a block IS that
 * ordinal, so the number of objects born in [a,b] is exactly b-a+1 — no
 * second instrument and no second run.  The census's own accounting proves
 * the clock is dense: `deaths + live == seq`, checked below and REFUSED on.
 *
 * WHAT THIS FILE CANNOT SEE, stated before any number.  The block dump holds
 * SURVIVORS.  It cannot say how many chunks a boot arena would have carved to
 * serve the window's CHURN, only how few it could have got away with if the
 * window were pure.  So `chunksB` here is a LOWER bound exactly as it is in
 * `segregate.mjs`, and a no-recycling upper bound is printed beside it.  The
 * gap between them is governed by the window's survival rate, which is the
 * number this file exists to measure — at 98% the two bounds coincide.
 *
 * THE CEILING, printed beside every row.  `segregate.mjs`'s ORACLE — a
 * perfect per-object predictor — is 96 chunks against 114 held: 18 chunks,
 * 1.13 MiB, 1.5% of the run's 74.08 MiB settled privateCommit.  No key can
 * beat it.  A row here that does is a bug in this file, and it refuses.
 */
import { readFileSync } from 'node:fs'

const argv = process.argv.slice(2)
const arg = (n, d) => { const i = argv.indexOf(n); return i < 0 ? d : argv[i + 1] }
const LIFE = arg('--life')
const BLOCKS = arg('--blocks', LIFE + '.blocks')
const lines = readFileSync(LIFE, 'utf8').split(/\r?\n/)

const meta = {}
for (const l of lines) {
  const m = /^\[lifecen\] (\w+) (.*)$/.exec(l)
  if (!m) continue
  for (const kv of m[2].split(/\s+/)) {
    const i = kv.indexOf('=')
    if (i > 0) meta[m[1] + '.' + kv.slice(0, i)] = kv.slice(i + 1)
  }
}
const SEQ = Number(meta['CLOCK.seq'])
const DEATHS = Number(meta['CLOCK.deaths'])
const LIVE = Number(meta['CLOCK.live'])
const ALLBYTES = Number(meta['CLOCK.bytes'])
const HELD = Number(meta['WALK.chunks'])
const CHUNK = 65536, CARVE = 65280

const out = []
const P = (s) => out.push(s)

P('=== phase: is the startup cohort separable as a POLICY? ===')
P('file ' + LIFE)
P('')
P('--- the controls, before any number -------------------------------------')

/* CONTROL 1 — THE CLOCK IS DENSE.  Every cycle allocation takes exactly one
 * ordinal and ends in exactly one of two states, so "objects born in [a,b]"
 * is b-a+1 with no instrument at all.  If that identity does not hold, the
 * denominator of every survival rate below is invented. */
const identity = DEATHS + LIVE === SEQ
P('clock seq=' + SEQ + '  deaths=' + DEATHS + '  live=' + LIVE)
P('DENSE-CLOCK IDENTITY  deaths + live == seq : ' + DEATHS + ' + ' + LIVE + ' = ' +
  (DEATHS + LIVE) + (identity ? ' == ' + SEQ + '  OK' : ' != ' + SEQ + '  REFUSED'))
if (!identity) {
  P('REFUSED: the ordinal clock is not dense; every survival rate below is void')
  console.log(out.join('\n')); process.exit(3)
}

const blocks = []
for (const l of readFileSync(BLOCKS, 'utf8').split(/\r?\n/)) {
  if (!l.startsWith('B ')) continue
  const f = l.split(' ')
  if (f[4] === 'UNJOINED') continue
  blocks.push({ addr: BigInt('0x' + f[1]), stride: Number(f[2]), nlive: Number(f[3]),
                role: Number(f[4]), ki: Number(f[5]), si: Number(f[6]),
                birth: Number(f[7]), cens: Number(f[8]) })
}
for (let i = 0; i < blocks.length; i++) blocks[i].ix = i

/* CONTROL 0 — THE NULL ARM.  `smoke.ts` leaves by return, the runtime tears
 * its globals down first, and the arena is EMPTY at the walk.  A file that
 * prints a cohort there is reading noise.  It must say so by name, not print
 * a silent zero and a table of NaNs. */
if (blocks.length === 0) {
  P('NULL ARM: the walk found no live block in any held chunk.  There is no')
  P('population to phase and this file refuses to invent one.  That is the')
  P('correct answer for smoke.ts, whose globals are torn down before exit, and')
  P('it is a REFUSAL for any arm that was supposed to have a settled arena.')
  console.log(out.join('\n')); process.exit(0)
}

/* CONTROL 2 — A SURVIVOR IS NOT A PINNER, and the complement is reported.
 * The walk's live count is the population in chunks the arena still HOLDS;
 * the clock's is every live cycle object.  The difference is survivors that
 * are pooled or calloc'd and pin no chunk.  They are in the DENOMINATOR of
 * every rate below and not in the numerator, so every rate here is a FLOOR. */
const complement = LIVE - blocks.length
P('PINNER vs SURVIVOR    walk live=' + blocks.length + '  clock live=' + LIVE +
  '  complement=' + complement + ' survivors pin no held chunk')
P('                      they are in every denominator below and in no numerator, so every rate here is a FLOOR')

/* CONTROL 3 — the chunk reconstruction, byte-for-byte segregate.mjs's. */
const chunksArr = []
{
  let cur = null
  for (const b of blocks) {
    const startNew = cur === null || b.stride !== cur.stride ||
      b.addr <= cur.last || (b.addr - cur.first) >= 65536n
    if (startNew) { cur = { stride: b.stride, first: b.addr, last: b.addr, bs: [] }; chunksArr.push(cur) }
    cur.last = b.addr
    cur.bs.push(b)
    b.chunk = chunksArr.length - 1
  }
}
const chunkCheckBad = chunksArr.filter((c) => c.bs.some((b) => b.nlive !== c.bs.length)).length
P('CHUNK RECONSTRUCTION  ' + chunksArr.length + ' non-empty groups; lines whose own nlive disagrees with the group size: ' +
  chunkCheckBad + '; the walk said ' + HELD + ', so ' + (HELD - chunksArr.length) + ' held nothing live')
if (chunkCheckBad) {
  P('REFUSED: the chunk reconstruction does not reconcile')
  console.log(out.join('\n')); process.exit(3)
}
for (const c of chunksArr) {
  c.minB = Math.min(...c.bs.map((b) => b.birth))
  c.maxB = Math.max(...c.bs.map((b) => b.birth))
}
P('')

/* ---- 1. THE UNCENSORED NUMBER ---------------------------------------- */
const births = blocks.map((b) => b.birth).sort((a, b) => a - b)
const survLE = (n) => {
  let lo = 0, hi = births.length
  while (lo < hi) { const m = (lo + hi) >> 1; if (births[m] <= n) lo = m + 1; else hi = m }
  return lo
}

P('--- 1. THE SURVIVAL RATE OF THE STARTUP WINDOW, which README.md does not report ---')
P('')
P('README.md reports the CENSORED conditional: given a survivor, where was it born.')
P('This is the other one: given a birth window, what fraction of it is still alive.')
P('The denominator is the window width, exactly, by the dense-clock identity above.')
P('')
P('window (lo,hi]              born     survived   SURVIVAL%   share of all survivors')
/* clamped to the clock so a SHORT arm (the smoke controls run 801,601
 * allocations) cannot print a bucket of negative width. */
const edges = [...new Set([0, 100, 1000, 5000, 10000, 20000, 30000, 40000, 50000, 60000,
                           70000, 80000, 90000, 100000, 120000, 150000, 200000, 500000,
                           1000000, 10000000, SEQ].filter((e) => e <= SEQ))].sort((x, y) => x - y)
for (let i = 1; i < edges.length; i++) {
  const lo = edges[i - 1], hi = edges[i]
  const n = survLE(hi) - survLE(lo), w = hi - lo
  P(('(' + lo + ',' + hi + ']').padEnd(24) + String(w).padStart(10) + String(n).padStart(12) +
    (100 * n / w).toFixed(3).padStart(11) + '%' + (100 * n / blocks.length).toFixed(2).padStart(13) + '%')
}
P('')
P('cumulative, which is what a cut at N actually buys:')
P('cut N          born     survived    PURITY%   RECALL% of survivors')
for (const N of [...new Set([1000, 10000, 30000, 50000, 70000, 92182, 100000, 120000,
                             200000, 1000000, 10000000, SEQ].filter((e) => e <= SEQ))].sort((x, y) => x - y)) {
  const s = survLE(N)
  P(String(N).padStart(10) + String(N).padStart(13) + String(s).padStart(12) +
    (100 * s / N).toFixed(2).padStart(10) + '%' + (100 * s / blocks.length).toFixed(2).padStart(10) + '%')
}
P('')

/* ---- 2. IS THERE A KNEE, OR ONLY A PERCENTILE? ----------------------- */
P('--- 2. IS THERE A PHASE BOUNDARY AT ALL? ---')
P('')
P('A percentile exists in every distribution.  A BOUNDARY is a place where the')
P('survival rate falls off a cliff and stays down.  5,000-wide buckets, 0..250k:')
P('')
for (let lo = 0; lo < 250000; lo += 5000) {
  const n = survLE(lo + 5000) - survLE(lo)
  const pct = 100 * n / 5000
  P(('(' + lo + ',' + (lo + 5000) + ']').padEnd(20) + String(n).padStart(7) +
    pct.toFixed(2).padStart(9) + '%  ' + '#'.repeat(Math.round(pct / 2.5)))
}
const lastSurv = births[births.length - 1]
const tail200k = blocks.length - survLE(200000)
const tail1M = blocks.length - survLE(1000000)
const tail10M = blocks.length - survLE(10000000)
P('')
P('beyond ordinal 200,000 — ' + (100 * 200000 / SEQ).toFixed(2) + '% of the run — there are ' +
  tail200k + ' survivors in ' + (SEQ - 200000) + ' allocations: ' +
  (100 * tail200k / (SEQ - 200000)).toExponential(2) + '%')
P('beyond 1,000,000: ' + tail1M + ' survivors.  beyond 10,000,000: ' + tail10M +
  '.  the last survivor was born at ordinal ' + lastSurv + '.')
P('The steady state retains ' + tail200k + ' objects out of ' + (SEQ - 200000) +
  ' allocations.  That is the floor no boot arena reaches.')
P('')
P('--- per-chunk temporal coherence: do chunks MIX phases? ---')
const spans = chunksArr.map((c) => c.maxB - c.minB).sort((a, b) => a - b)
P('span of birth ordinals INSIDE one chunk (max-min over its live blocks), deciles:')
P('  ' + [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
  .map((d) => 'p' + d * 10 + '=' + spans[Math.min(spans.length - 1, Math.floor(d / 10 * spans.length))])
  .join('  '))
P('the median chunk\'s survivors span ' + spans[spans.length >> 1] + ' allocations of a ' + SEQ + '-allocation run.')
P('')

/* ---- 3. THE SIMULATION, in segregate.mjs's exact frame ---------------- */
function packPerClass(bs) {
  const byStride = new Map()
  for (const b of bs) byStride.set(b.stride, (byStride.get(b.stride) || 0) + b.stride)
  let chunks = 0
  for (const [, bytes] of byStride) chunks += Math.ceil(bytes / CARVE)
  return { chunks, bytes: [...byStride.values()].reduce((a, b) => a + b, 0), byStride }
}
const oracle = packPerClass(blocks)
const activeClasses = new Set(blocks.map((b) => b.stride)).size
const ORACLE_TOTAL = oracle.chunks + activeClasses
const CEILING = HELD - ORACLE_TOTAL

P('--- 3. THE PHASE KEY, SIMULATED AT CHUNK LEVEL ---')
P('')
P('The frame is segregate.mjs\'s, unchanged, so the rows are comparable to its:')
P('  B        the routed set — here, every survivor born at or before N')
P('  chunksB  B packed PERFECTLY, per size class (a chunk serves one class)')
P('  noRecyc  the other end of that bound: the window with NO slot ever reused')
P('  freed    chunks of which EVERY live block went to B.  One straggler keeps 64 KiB.')
P('  Aleft    non-empty chunks that still keep something')
P('  curA     one current chunk per class still active on the mixed side; never released')
P('  total    chunksB + Aleft + curA')
P('')
P('THE CEILING: the ORACLE is ' + oracle.chunks + ' + 0 + ' + activeClasses + ' = ' + ORACLE_TOTAL +
  ' against ' + HELD + ' held = ' + CEILING + ' chunks = ' + (CEILING * CHUNK / 1048576).toFixed(2) +
  ' MiB = 1.5% of the run\'s 74.08 MiB settled privateCommit.')
P('No key can beat it.  A row below that does is a bug in this file, not a result, and it refuses.')
P('')
const meanPhys = ALLBYTES / SEQ
P('cut N        B surv  purity%  chunksB  noRecyc  freed  Aleft  curA  total  vsHELD  of ceiling')
const cuts = [...new Set([10000, 30000, 50000, 70000, 92182, 100000, 120000, 150000, 200000,
                          500000, 1000000, 10000000, 20000000, SEQ].filter((e) => e <= SEQ))]
  .sort((x, y) => x - y)
let best = null
const rowsOut = []
for (const N of cuts) {
  const B = blocks.filter((b) => b.birth <= N)
  const pk = packPerClass(B)
  let freed = 0
  for (const c of chunksArr) if (c.maxB <= N) freed++
  const aLeft = chunksArr.length - freed
  const tot = pk.chunks + aLeft + activeClasses
  const vs = tot - HELD
  /* THE NO-RECYCLING UPPER BOUND on the boot arena: every allocation in the
   * window gets its own slot and nothing is ever reused.  Survivor bytes per
   * class are known exactly; the window's dead are charged the run's MEAN
   * physical size and split across classes in the survivors' own byte
   * proportions.  THAT SPLIT IS AN ASSUMPTION and the only one in this file:
   * the census carries no per-class birth-windowed byte count, and taking one
   * needs a re-instrumented run, which this slice did not do.  It is
   * rounded up PER CLASS, so it is >= chunksB by construction.  The truth is
   * between chunksB and noRecyc, and the window's PURITY says where: at 98%
   * they nearly coincide, at 36% they do not. */
  const deadBytes = (N - B.length) * meanPhys
  let noRecyc = 0
  for (const [, bytes] of pk.byStride)
    noRecyc += Math.ceil((bytes + deadBytes * (bytes / pk.bytes)) / CARVE)
  const pur = 100 * B.length / N
  rowsOut.push({ N, S: B.length, pur, chunksB: pk.chunks, noRecyc, freed, aLeft, tot, vs })
  P(String(N).padStart(9) + String(B.length).padStart(9) + pur.toFixed(2).padStart(9) +
    String(pk.chunks).padStart(9) + String(noRecyc).padStart(9) + String(freed).padStart(7) +
    String(aLeft).padStart(7) + String(activeClasses).padStart(6) + String(tot).padStart(7) +
    (vs >= 0 ? '+' + vs : String(vs)).padStart(8) +
    (vs < 0 ? (100 * (-vs) / CEILING).toFixed(0) + '%' : '0%').padStart(12))
  if (best === null || tot < best.tot) best = { N, tot, vs, freed, aLeft, chunksB: pk.chunks, S: B.length, pur, noRecyc }
}
P('')
if (best.tot < ORACLE_TOTAL) {
  P('REFUSED (P3 STOP CONDITION): a phase cut reports ' + (HELD - best.tot) +
    ' chunks freed against the per-object ORACLE\'s ' + CEILING + '.')
  P('The oracle is perfect and per-object.  No key can exceed it.  This simulation is wrong.')
  console.log(out.join('\n')); process.exit(4)
}
P('P3 check: the best phase total is ' + best.tot + ' >= the oracle total ' + ORACLE_TOTAL +
  '.  No row beats the per-object oracle.  OK')
P('The last row routes EVERY survivor and therefore IS the oracle; it is printed to show')
P('the sweep reaching it, not as a phase policy — a cut at the end of the run is not a phase.')
P('')

/* ---- 4. THE NULL CONTROL -------------------------------------------- */
P('--- 4. NULL CONTROL: is `freed` temporal structure, or just routing a lot? ---')
P('')
P('A cut at N=200,000 routes 99.8% of all survivors, and routing almost everything')
P('frees almost every chunk WHATEVER the key is.  So the freed column proves nothing')
P('on its own.  The control holds each cut\'s |B| fixed and chooses B uniformly at')
P('random instead: if the phase key is doing real work, it must free far more.')
P('')
let seed = 0x9e3779b9 >>> 0
const rnd = () => {
  seed ^= seed << 13; seed >>>= 0
  seed ^= seed >>> 17
  seed ^= seed << 5; seed >>>= 0
  return seed / 4294967296
}
const TRIALS = 200
P('cut N        |B|   freed(phase)   freed(random, mean of ' + TRIALS + ')   freed(random, max)')
for (const r of rowsOut) {
  if (![50000, 92182, 200000, 1000000, 10000000].includes(r.N)) continue
  let sum = 0, mx = 0
  for (let t = 0; t < TRIALS; t++) {
    const mark = new Uint8Array(blocks.length)
    let picked = 0
    while (picked < r.S) { const j = Math.floor(rnd() * blocks.length); if (!mark[j]) { mark[j] = 1; picked++ } }
    let f = 0
    for (const c of chunksArr) {
      let all = 1
      for (const b of c.bs) if (!mark[b.ix]) { all = 0; break }
      if (all) f++
    }
    sum += f
    if (f > mx) mx = f
  }
  P(String(r.N).padStart(9) + String(r.S).padStart(9) + String(r.freed).padStart(15) +
    (sum / TRIALS).toFixed(2).padStart(29) + String(mx).padStart(21))
}
P('')

/* ---- 5. WHAT KEEPS THE RESIDUE -------------------------------------- */
P('--- 5. WHAT THE BOOT ARENA CANNOT REACH ---')
P('')
P('The phase key is bounded not by its recall but by Aleft: the chunks that keep a')
P('LATE survivor.  Those chunks stay whatever the boot arena does with the early ones.')
P('')
P('cut N     chunks with a survivor born after N     late survivors in them     bytes')
for (const N of [50000, 92182, 200000, 1000000, 10000000]) {
  const cs = chunksArr.filter((c) => c.maxB > N)
  const late = cs.reduce((a, c) => a + c.bs.filter((b) => b.birth > N).length, 0)
  const by = cs.reduce((a, c) => a + c.bs.filter((b) => b.birth > N).reduce((x, b) => x + b.stride, 0), 0)
  P(String(N).padStart(9) + String(cs.length).padStart(40) + String(late).padStart(27) + String(by).padStart(10))
}
P('')
P('Read the last row: a handful of objects born deep in the steady state keep whole')
P('64 KiB chunks each, and no birth-time key reaches them — they ARE the late phase.')
P('')
console.log(out.join('\n'))
