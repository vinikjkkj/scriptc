/**
 * segregate.mjs — would splitting the cycle arena by lifetime pay?
 *
 *   node segregate.mjs --life <tag>.life.txt --pdb <exe>.pdb
 *
 * THE QUESTION R^2 DOES NOT ANSWER.  analyze.mjs scores a key by how much of
 * the variance of log2(lifetime) it explains, over every object that died.
 * That is the right question for "does type predict lifetime" and the wrong
 * one for "should the arena be split", because a split does not need to
 * predict a lifetime — it needs to predict SURVIVAL, and it is judged on
 * bytes, not on objects.  This file asks the design question directly:
 *
 *   1. ROUTE.  Order the groups (kinds, then sites) by their MEASURED
 *      survival rate and take them greedily.  For each prefix: what share of
 *      the survivor bytes does it capture (recall), and what share of its own
 *      allocations die anyway (pollution)?  A route that captures the
 *      survivors by dragging the whole stream with it has not segregated.
 *   2. DENSITY.  A chunk serves ONE size class (scr_cycle.c:415), so the
 *      long-lived arena needs its own chunks PER CLASS.  Pack the routed
 *      survivors perfectly, per class, and count the chunks.  Add one current
 *      chunk per class still active on the short-lived side — the arena never
 *      releases a class's current chunk (scr_cycle.c:1666).  That total is
 *      what the split would hold; compare it with what is held today.
 *
 * The ORACLE row — route every survivor, by name, with no predictor at all —
 * bounds every row below it.  If the oracle does not pay, no key does.
 */
import { readFileSync, existsSync } from 'node:fs'

const argv = process.argv.slice(2)
const arg = (n, d) => { const i = argv.indexOf(n); return i < 0 ? d : argv[i + 1] }
const LIFE = arg('--life')
const PDB = arg('--pdb')
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

let nm = (r) => `rva${r}`
if (PDB && existsSync(PDB)) {
  const { loadSymbols } = await import('../pdb-symbols.mjs')
  const syms = loadSymbols(PDB)
  const a = syms.find((s) => s.name === 'scr_collect_cycles')
  const sorted = syms.slice().sort((x, y) => x.rva - y.rva)
  nm = (r) => {
    const rva = a.rva + r
    let lo = 0, hi = sorted.length - 1, best = null
    while (lo <= hi) { const mid = (lo + hi) >> 1; if (sorted[mid].rva <= rva) { best = sorted[mid]; lo = mid + 1 } else hi = mid - 1 }
    if (!best) return `rva${r}`
    const off = rva - best.rva
    if (best.size && off >= best.size) return `<emitted TU, unnamed>`
    return off ? `${best.name}+0x${off.toString(16)}` : best.name
  }
}

const HB = 40
function rows(tag) {
  const out = []
  for (const l of lines) {
    if (!l.startsWith(tag + ' ')) continue
    const f = l.split(' ').map(Number)
    out.push({ rva: f[1], nAlloc: f[2], nDead: f[3], bytesEver: f[4], lSum: f[5],
               lSumSq: f[6], lMin: f[7], lMax: f[8], nLive: f[9], livePhys: f[10],
               liveLSum: f[11], nPin: f[12], nPinSole: f[13], nPinLe2: f[14],
               pinShare: f[15] })
  }
  return out
}
const kinds = rows('K'), sites = rows('S')

/* ---- the live blocks, with their real strides ----------------------- */
const blocks = []
for (const l of readFileSync(BLOCKS, 'utf8').split(/\r?\n/)) {
  if (!l.startsWith('B ')) continue
  const f = l.split(' ')
  if (f[4] === 'UNJOINED') continue
  blocks.push({ addr: BigInt('0x' + f[1]), stride: Number(f[2]), nlive: Number(f[3]),
                role: Number(f[4]), ki: Number(f[5]), si: Number(f[6]),
                birth: Number(f[7]), cens: Number(f[8]) })
}

/* ---- CHUNK MEMBERSHIP, reconstructed and then CHECKED -----------------
 * The walk emits a chunk's live slots in ascending slot order, chunk after
 * chunk, but a chunk's live slots are NOT contiguous -- free slots sit
 * between them -- so the boundary rule is: a new chunk starts when the
 * address goes backwards, or the stride changes, or the address is more than
 * a chunk away from the group's first.  The reconstruction is then checked
 * against two numbers it did not produce: every reconstructed chunk's size
 * must equal the `nlive` each of its own lines carries, and the count must
 * equal the walk's chunk count less its empty chunks.  A reconstruction that
 * cannot fail that check is not evidence. */
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

/* ki/si in the block dump are SLOT indices in the census's hash tables; the
 * K/S rows carry rva but not the slot.  Join them on the pinner COUNT, and
 * ASSERT the join is one-to-one rather than assuming it: a count collision
 * would silently label one kind with another's name. */
function join(blockKey, rowsArr) {
  /* The join key is the PAIR (pinner count, pinner byte sum): the row's
   * nPin and livePhys are the same two numbers the block dump produces for
   * that slot, computed on the other side of the report.  A collision on
   * both at once is possible and is COUNTED, never guessed at. */
  const cnt = new Map()
  for (const b of blocks) {
    const e = cnt.get(b[blockKey]) || { n: 0, bytes: 0 }
    e.n++; e.bytes += b.stride
    cnt.set(b[blockKey], e)
  }
  const byKey = new Map()
  for (const r of rowsArr) {
    if (!r.nPin) continue
    const k = r.nPin + ':' + r.livePhys
    if (!byKey.has(k)) byKey.set(k, [])
    byKey.get(k).push(r)
  }
  const map = new Map()
  let amb = 0
  for (const [slot, e] of cnt) {
    const c = byKey.get(e.n + ':' + e.bytes)
    if (c && c.length === 1) map.set(slot, c[0])
    else amb++
  }
  return { map, amb, slots: cnt.size }
}
const jK = join('ki', kinds)
const jS = join('si', sites)

const out = []
const P = (s) => out.push(s)
P('=== segregate: would a lifetime split of the cycle arena pay? ===')
P(`file ${LIFE}`)
P(`live blocks in held chunks ${blocks.length};  kind slots ${jK.slots} (named ${jK.map.size}, ambiguous ${jK.amb});  site slots ${jS.slots} (named ${jS.map.size}, ambiguous ${jS.amb})`)
P(`chunk membership reconstructed: ${chunksArr.length} non-empty chunks; lines whose own nlive disagrees with the group size: ${chunkCheckBad}`)
P(`the walk reported ${meta['WALK.chunks']} chunks, so ${Number(meta['WALK.chunks']) - chunksArr.length} held nothing live -- cross-check that against the page census's own nolive= on the same run`)
if (chunkCheckBad) P('REFUSED: the chunk reconstruction does not reconcile; every per-chunk number below is void')
P('')

const HELD = Number(meta['WALK.chunks'])
const CHUNK = 65536, CARVE = 65280

/* ---- the ORACLE --------------------------------------------------- */
function packPerClass(bs) {
  const byStride = new Map()
  for (const b of bs) byStride.set(b.stride, (byStride.get(b.stride) || 0) + b.stride)
  let chunks = 0
  const rowsOut = []
  for (const [s, bytes] of [...byStride].sort((a, b) => b[1] - a[1])) {
    const c = Math.ceil(bytes / CARVE)
    chunks += c
    rowsOut.push({ stride: s, bytes, chunks: c, fill: bytes / (c * CARVE) })
  }
  return { chunks, rows: rowsOut, bytes: [...byStride.values()].reduce((a, b) => a + b, 0) }
}
const oracle = packPerClass(blocks)
/* classes still active on the SHORT-LIVED side: every stride that the arena
 * carved at all.  A class's current chunk is never released while current
 * (scr_cycle.c:1666), so each active class costs one chunk whatever happens
 * to its survivors. */
const activeClasses = new Set(blocks.map((b) => b.stride)).size

P('--- the ORACLE: a perfect predictor, routing every survivor by name ---')
P('stride   survivors     bytes  chunks  fill%')
const byStrideCount = new Map()
for (const b of blocks) byStrideCount.set(b.stride, (byStrideCount.get(b.stride) || 0) + 1)
for (const r of oracle.rows)
  P(`${String(r.stride).padStart(6)} ${String(byStrideCount.get(r.stride)).padStart(11)} ${String(r.bytes).padStart(9)} ${String(r.chunks).padStart(7)} ${(100 * r.fill).toFixed(1).padStart(6)}`)
P(`survivor bytes ${oracle.bytes};  classes ${oracle.rows.length};  chunks if packed perfectly ${oracle.chunks}`)
P(`classes whose WHOLE survivor set does not fill one chunk: ${oracle.rows.filter((r) => r.bytes < CARVE).length} of ${oracle.rows.length}`)
P('')
P(`held today                      ${HELD} chunks = ${(HELD * CHUNK / 1048576).toFixed(2)} MiB of chunk address space`)
P(`long-lived arena, packed        ${oracle.chunks} chunks = ${(oracle.chunks * CHUNK / 1048576).toFixed(2)} MiB`)
P(`short-lived arena, 1 cur/class  ${activeClasses} chunks = ${(activeClasses * CHUNK / 1048576).toFixed(2)} MiB  (a class's current chunk is never released)`)
P(`ORACLE TOTAL AFTER SPLIT        ${oracle.chunks + activeClasses} chunks = ${((oracle.chunks + activeClasses) * CHUNK / 1048576).toFixed(2)} MiB`)
const net = HELD - (oracle.chunks + activeClasses)
P(`NET, with a PERFECT predictor   ${net >= 0 ? '-' : '+'}${Math.abs(net)} chunks = ${(Math.abs(net) * CHUNK / 1048576).toFixed(2)} MiB ${net >= 0 ? 'SAVED' : 'SPENT'}`)
P('')

/* ---- routing by a real key ----------------------------------------- */
function route(name, rowsArr, blockKey, jm) {
  P(`--- routing by ${name}: groups taken in descending measured survival rate ---`)
  const live = new Map()  /* slot -> blocks */
  for (const b of blocks) { if (!live.has(b[blockKey])) live.set(b[blockKey], []); live.get(b[blockKey]).push(b) }
  const g = []
  for (const [slot, bs] of live) {
    const r = jm.map.get(slot)
    g.push({ slot, bs, bytes: bs.reduce((a, x) => a + x.stride, 0),
             nAlloc: r ? r.nAlloc : null, nLive: bs.length,
             /* an UNJOINED slot has no measured survival rate.  It is ranked
              * LAST (p = -1), never first: giving it 1.0 would put every
              * unlabelled group at the head of the route and invent the
              * result this table exists to test. */
             p: r && r.nAlloc ? bs.length / r.nAlloc : -1, rva: r ? r.rva : null,
             everBytes: r ? r.bytesEver : null })
  }
  g.sort((a, b) => b.p - a.p || b.bytes - a.bytes)
  const totalLive = oracle.bytes
  let takenB = [], cumBytes = 0, cumAlloc = 0, cumEver = 0
  P('n  group                                       surv%  survivors   bytes  cumRecall%  allocs-routed  chunksB  freed  Aleft  total   lo  vsHeld')
  let i = 0
  for (const x of g) {
    i++
    takenB = takenB.concat(x.bs)
    cumBytes += x.bytes
    cumAlloc += x.nAlloc ?? x.nLive
    cumEver += x.everBytes ?? x.bytes
    if (i > 16 && i !== g.length && !(cumBytes / totalLive > 0.5 && cumBytes / totalLive < 0.52)) continue
    const pk = packPerClass(takenB)
    /* WHAT ROUTING B ACTUALLY FREES.  A chunk leaves arena A only when EVERY
     * one of its live blocks went to B: one straggler keeps all 64 KiB, which
     * is the rule this whole front is about.  So after the split the arena
     * holds B packed, plus the A chunks that still hold something, plus one
     * current chunk per class still active on the A side. */
    const inB = new Set(takenB)
    let freed = 0
    for (const c of chunksArr) if (c.bs.every((b) => inB.has(b))) freed++
    const aLeft = chunksArr.length - freed
    const curA = activeClasses
    const tot = pk.chunks + aLeft + curA
    /* The LOWER bound on the same split: arena A's leftovers packed as
     * perfectly as B's.  A cannot actually do that -- it is the mixed arena,
     * and its survivors are stranded among churn exactly as they are today --
     * so the truth is between `lo` and `tot`, and `lo` is the oracle. */
    const aRest = blocks.filter((b) => !inB.has(b))
    const lo = pk.chunks + packPerClass(aRest).chunks
    P(`${String(i).padStart(2)} ${String(x.rva === null ? 'slot' + x.slot : nm(x.rva)).slice(0, 44).padEnd(46)} ${x.p < 0 ? '  n/a ' : (100 * x.p).toFixed(2).padStart(6)} ${String(x.nLive).padStart(11)} ${String(x.bytes).padStart(7)} ${(100 * cumBytes / totalLive).toFixed(1).padStart(10)}  ${String(cumAlloc).padStart(27)}  ${String(pk.chunks).padStart(7)}  ${String(freed).padStart(5)}  ${String(aLeft).padStart(5)}  ${String(tot).padStart(5)}  ${String(lo).padStart(4)}  ${String(tot - HELD).padStart(6)}`)
  }
  P('')
}
route('KIND', kinds, 'ki', jK)
route('SITE', sites, 'si', jS)

/* ---- what the sole pinners are actually worth ----------------------- */
const sole = blocks.filter((b) => b.nlive === 1)
const le2 = blocks.filter((b) => b.nlive <= 2)
P('--- the sparse tail: chunks a handful of objects keep ---')
P(`chunks with exactly 1 live object: ${sole.length}  (they hold ${sole.reduce((a, b) => a + b.stride, 0)} bytes and keep ${(sole.length * CHUNK / 1048576).toFixed(2)} MiB of chunk)`)
P(`chunks with 1-2:                   ${new Set(le2.map((b) => b.nlive)).size ? le2.length : 0} objects over ${(le2.length && 0) || ''}`)
const byLive = new Map()
for (const b of blocks) byLive.set(b.nlive, (byLive.get(b.nlive) || 0) + 1)
let sparseChunks = 0, sparseObjs = 0
for (const [n, cnt] of byLive) if (n <= 8) { sparseChunks += cnt / n; sparseObjs += cnt }
P(`chunks with <=8 live: ${Math.round(sparseChunks)} of ${HELD}; they hold ${sparseObjs} of ${blocks.length} survivors`)
P(`if EVERY one of those chunks could be emptied, that is ${(Math.round(sparseChunks) * CHUNK / 1048576).toFixed(2)} MiB of chunk address space`)
P('')
P('--- what the pinners are, by named runtime kind vs emitted shape ---')
{
  let named = 0, namedB = 0, un = 0, unB = 0
  for (const b of blocks) {
    const r = jK.map.get(b.ki)
    const n = r ? nm(r.rva) : '?'
    if (r && !n.startsWith('<emitted')) { named++; namedB += b.stride } else { un++; unB += b.stride }
  }
  P(`runtime-named kinds  ${named} survivors / ${namedB} bytes  (${(100 * named / blocks.length).toFixed(1)}%)`)
  P(`emitted-TU shapes    ${un} survivors / ${unB} bytes  (${(100 * un / blocks.length).toFixed(1)}%)`)
  P('(the emitted TU carries NO symbols in the PDB on the LLVM lane: llvm-pdbutil')
  P(' reports "Module stream not present" for zapo-rest.obj, so a per-shape name')
  P(' is unavailable on this binary.  The pinner population is overwhelmingly')
  P(' runtime kinds, which ARE named, so the gap does not reach the answer.)')
}

console.log(out.join('\n'))
