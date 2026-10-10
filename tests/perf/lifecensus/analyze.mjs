/**
 * analyze.mjs — read a scr_life_census.h report and answer the two halves.
 *
 *   node analyze.mjs --life <tag>.life.txt --pdb <exe>.pdb [--blocks <file>]
 *
 * HALF 1, does a key predict lifetime.  Every death contributed
 * L = 256*log2(life+1) to its group's (n, sum, sumsq).  For a key K the
 * explained fraction of the variance of L is
 *     R2(K) = 1 - (sum over groups of SS_within) / SS_total
 * SS_within for a group is sumsq - sum^2/n; SS_total is the same over the
 * whole population.  The three keys — KIND, SITE, KIND x SITE — are scored
 * on ONE population, so "site beats type" is a comparison and not two
 * stories.  R2 is reported with the group COUNT beside it, because a key
 * with as many groups as objects explains everything and predicts nothing:
 * the adjusted form (omega^2) is printed next to it for exactly that.
 *
 * HALF 2, is the long-lived set dense enough to fill chunks.  THE ARENA IS
 * PER SIZE CLASS (scr_cycle.c: "One chunk serves one size class"), so the
 * density question is per stride and not in aggregate.  For each stride the
 * survivors occupy, this computes how many 64 KiB chunks they would fill if
 * packed perfectly, and compares that with the chunks actually held.  That
 * is the ORACLE — a perfect lifetime predictor — so it is an upper bound on
 * every real one, and a stride whose entire survivor set does not fill one
 * chunk cannot be made dense by any key at all.
 */
import { readFileSync, existsSync } from 'node:fs'

const argv = process.argv.slice(2)
const arg = (n, d) => { const i = argv.indexOf(n); return i < 0 ? d : argv[i + 1] }
const LIFE = arg('--life')
const PDB = arg('--pdb')
const BLOCKS = arg('--blocks', LIFE ? LIFE + '.blocks' : undefined)
if (!LIFE) { console.error('need --life'); process.exit(2) }

const text = readFileSync(LIFE, 'utf8')
const lines = text.split(/\r?\n/)

const meta = {}
for (const l of lines) {
  const m = /^\[lifecen\] (\w+(?: \w+)?) (.*)$/.exec(l)
  if (!m) continue
  for (const kv of m[2].split(/\s+/)) {
    const i = kv.indexOf('=')
    if (i > 0) meta[m[1].split(' ')[0] + '.' + kv.slice(0, i)] = kv.slice(i + 1)
  }
  if (/^\[lifecen\] (NO CHUNKS|NO DEATHS)/.test(l)) meta[m[1]] = true
}
const refuse = []
if (/\[lifecen\] NO CHUNKS/.test(text)) refuse.push('NO CHUNKS')
if (/\[lifecen\] NO DEATHS/.test(text)) refuse.push('NO DEATHS')
for (const k of ['SELFTEST.kindLost', 'SELFTEST.siteLost', 'SELFTEST.pairLost',
                 'SELFTEST.ptrLost', 'WALK.bad', 'WALK.badUsed', 'WALK.missed']) {
  if (meta[k] !== undefined && Number(meta[k]) !== 0) refuse.push(`${k}=${meta[k]}`)
}

/* ---- symbols -------------------------------------------------------- */
let symAt = () => null
let anchorRva = 0
if (PDB && existsSync(PDB)) {
  const mod = await import('../pdb-symbols.mjs')
  const syms = mod.loadSymbols(PDB)          // [{rva,name,size}] sorted
  const byName = new Map(syms.map((s) => [s.name, s]))
  const a = byName.get('scr_collect_cycles')
  if (!a) { console.error('WARN: scr_collect_cycles not in the PDB; no symbols') }
  else {
    anchorRva = a.rva
    const sorted = syms.slice().sort((x, y) => x.rva - y.rva)
    symAt = (relToAnchor) => {
      const rva = anchorRva + relToAnchor
      let lo = 0, hi = sorted.length - 1, best = null
      while (lo <= hi) {
        const mid = (lo + hi) >> 1
        if (sorted[mid].rva <= rva) { best = sorted[mid]; lo = mid + 1 } else hi = mid - 1
      }
      if (!best) return null
      const off = rva - best.rva
      if (best.size && off >= best.size)
        return { name: `<unnamed,after ${best.name}>`, off: 0 }
      return { name: best.name, off }
    }
  }
}
const nm = (r) => { const s = symAt(r); return s ? (s.off ? `${s.name}+0x${s.off.toString(16)}` : s.name) : `rva${r}` }

/* ---- rows ------------------------------------------------------------ */
const HB = 40
function parseRows(tag) {
  const out = []
  for (const l of lines) {
    if (!l.startsWith(tag + ' ')) continue
    const f = l.split(' ')
    const r = {
      rva: Number(f[1]), nAlloc: Number(f[2]), nDead: Number(f[3]),
      bytesEver: Number(f[4]), lSum: Number(f[5]), lSumSq: Number(f[6]),
      lMin: Number(f[7]), lMax: Number(f[8]), nLive: Number(f[9]),
      livePhys: Number(f[10]), liveLSum: Number(f[11]), nPin: Number(f[12]),
      nPinSole: Number(f[13]), nPinLe2: Number(f[14]), pinShare: Number(f[15]),
      hist: f.slice(16, 16 + HB).map(Number),
    }
    out.push(r)
  }
  return out
}
const kinds = parseRows('K')
const sites = parseRows('S')
const pairs = []
for (const l of lines) {
  if (!l.startsWith('P ')) continue
  const f = l.split(' ')
  pairs.push({ krva: Number(f[1]), srva: Number(f[2]), nAlloc: Number(f[3]),
               nDead: Number(f[4]), lSum: Number(f[5]), lSumSq: Number(f[6]),
               nLive: Number(f[7]), nPin: Number(f[8]) })
}

/* ---- R^2 ------------------------------------------------------------- */
const gSum = Number(meta['GLOBAL.lsum'] ?? 0)
const gSumSq = Number(meta['GLOBAL.lsumsq'] ?? 0)
const gN = Number(meta['GLOBAL.n'] ?? 0)
const ssTotal = gSumSq - (gSum * gSum) / (gN || 1)

function r2(groups) {
  let within = 0, n = 0, k = 0
  for (const g of groups) {
    if (!g.nDead) continue
    k++
    n += g.nDead
    within += g.lSumSq - (g.lSum * g.lSum) / g.nDead
  }
  const R2 = 1 - within / ssTotal
  // omega^2: the same thing with the degrees of freedom charged for, so a
  // key with one group per object scores 0 instead of 1.
  const msWithin = (n - k) > 0 ? within / (n - k) : 0
  const ssBetween = ssTotal - within
  const omega2 = (ssBetween - (k - 1) * msWithin) / (ssTotal + msWithin)
  return { R2, omega2, groups: k, n }
}

/* reconciliation: the per-key n must equal the global n */
const kR = r2(kinds), sR = r2(sites), pR = r2(pairs)

const out = []
const P = (s) => out.push(s)
P('=== lifecensus analysis ===')
P(`file          ${LIFE}`)
P(`clock         seq=${meta['CLOCK.seq']} bytes=${meta['CLOCK.bytes']} deaths=${meta['CLOCK.deaths']} live=${meta['CLOCK.live']} livePeak=${meta['CLOCK.livepeak']}`)
P(`instrument    tableBytes=${meta['SELFTEST.tableBytes']} (${(Number(meta['SELFTEST.tableBytes']) / 1048576).toFixed(2)} MiB BSS)`)
P(`walk          chunks=${meta['WALK.chunks']} live=${meta['WALK.live']} joined=${meta['WALK.joined']} missed=${meta['WALK.missed']} bad=${meta['WALK.bad']} badUsed=${meta['WALK.badUsed']} held=${meta['WALK.held']}`)
P(`walk bytes    chunkBytes=${meta['WALK.chunkBytes']} liveBytes=${meta['WALK.liveBytes']}  occupancy=${(Number(meta['WALK.liveBytes']) / Number(meta['WALK.chunkBytes'] || 1)).toFixed(4)}`)
P(`survivors     n=${meta['SURVIVORS.n']} bytes=${meta['SURVIVORS.bytes']} inHeldChunks=${meta['SURVIVORS.inHeldChunks']}`)
P(refuse.length ? `REFUSALS      ${refuse.join(' ')}` : 'REFUSALS      none')
P('')

/* ---- P1: the chunk-live histogram ------------------------------------ */
const clLine = lines.find((l) => l.startsWith('[lifecen] CHUNKLIVE'))
if (clLine) {
  const f = clLine.split(/\s+/).slice(2)
  const h = f.slice(0, 17).map(Number)
  const tot = h.reduce((a, b) => a + b, 0)
  P('--- P1  how many live objects does a held chunk hold ---')
  P('live/chunk  chunks   share   cumulative')
  let cum = 0
  for (let i = 0; i < 17; i++) {
    if (!h[i]) continue
    cum += h[i]
    P(`${i === 16 ? '  16+' : String(i).padStart(5)}      ${String(h[i]).padStart(6)}  ${(100 * h[i] / tot).toFixed(1).padStart(5)}%  ${(100 * cum / tot).toFixed(1).padStart(5)}%`)
  }
  P(`total chunks ${tot};  holding exactly one ${clLine.match(/sole=(\d+)/)?.[1]};  one or two ${clLine.match(/le2=(\d+)/)?.[1]}`)
  P('')
}

/* ---- the global lifetime shape --------------------------------------- */
const gh = (lines.find((l) => l.startsWith('[lifecen] GLOBAL')) || '').split(/\s+/)
const ghi = gh.indexOf('hist')
if (ghi > 0) {
  const h = gh.slice(ghi + 1).map(Number)
  const tot = h.reduce((a, b) => a + b, 0)
  P('--- is lifetime bimodal?  deaths by log2(lifetime in allocations) ---')
  let cum = 0
  for (let i = 0; i < h.length; i++) {
    if (!h[i]) continue
    cum += h[i]
    const bar = '#'.repeat(Math.max(1, Math.round(60 * h[i] / Math.max(...h))))
    P(`2^${String(i).padStart(2)}  ${String(h[i]).padStart(10)}  ${(100 * cum / tot).toFixed(2).padStart(6)}%  ${bar}`)
  }
  P('')
}

/* ---- P2/P3: which key predicts --------------------------------------- */
P('--- P2 / P3  how much of the variance of log2(lifetime) a key explains ---')
P('key          groups       n        R^2    omega^2')
for (const [name, r] of [['KIND', kR], ['SITE', sR], ['KIND x SITE', pR]]) {
  P(`${name.padEnd(12)} ${String(r.groups).padStart(6)} ${String(r.n).padStart(9)}  ${r.R2.toFixed(4)}  ${r.omega2.toFixed(4)}`)
}
P(`SS_total ${ssTotal.toExponential(4)}  (n=${gN}; a key's n must match it: kind ${kR.n}, site ${sR.n}, pair ${pR.n})`)
P('')

/* ---- within-kind spread over sites: is type the wrong granularity? --- */
const byK = new Map()
for (const p of pairs) {
  if (!p.nDead) continue
  if (!byK.has(p.krva)) byK.set(p.krva, [])
  byK.get(p.krva).push(p)
}
const kindRows = kinds.filter((k) => k.nDead > 0).sort((a, b) => b.nDead - a.nDead)
P('--- the top kinds by deaths, and how much their own sites disagree ---')
P('kind                                              deaths   meanL   sdL  sites  within-kind R^2')
for (const k of kindRows.slice(0, 20)) {
  const mean = k.lSum / k.nDead
  const varr = Math.max(0, k.lSumSq / k.nDead - mean * mean)
  const ps = byK.get(k.rva) || []
  let w = 0, n = 0, g = 0
  for (const p of ps) { if (!p.nDead) continue; g++; n += p.nDead; w += p.lSumSq - p.lSum * p.lSum / p.nDead }
  const ssK = k.lSumSq - k.lSum * k.lSum / k.nDead
  const inner = ssK > 0 ? 1 - w / ssK : 0
  P(`${nm(k.rva).slice(0, 46).padEnd(48)} ${String(k.nDead).padStart(8)} ${(mean / 256).toFixed(2).padStart(6)} ${(Math.sqrt(varr) / 256).toFixed(2).padStart(5)} ${String(g).padStart(5)}  ${inner.toFixed(4)}`)
}
P('(meanL and sdL are log2 of the lifetime in allocations.)')
P('')

/* ---- the PINNERS ------------------------------------------------------ */
P('--- the pinner population: what is actually inside the chunks still held ---')
const pinK = kinds.filter((k) => k.nPin > 0).sort((a, b) => b.nPin - a.nPin)
const totPin = pinK.reduce((a, b) => a + b.nPin, 0)
const totSole = pinK.reduce((a, b) => a + b.nPinSole, 0)
P(`pinners ${totPin} in ${meta['WALK.chunks']} chunks;  alone in their chunk: ${totSole}`)
P('kind                                              pinners  sole  <=2  allocd   survival%  share-bytes')
for (const k of pinK.slice(0, 25)) {
  P(`${nm(k.rva).slice(0, 46).padEnd(48)} ${String(k.nPin).padStart(7)} ${String(k.nPinSole).padStart(5)} ${String(k.nPinLe2).padStart(4)} ${String(k.nAlloc).padStart(8)} ${(100 * k.nLive / Math.max(1, k.nAlloc)).toFixed(3).padStart(9)}  ${(k.pinShare / 1024).toFixed(0).padStart(8)} KiB`)
}
P('')
const pinS = sites.filter((k) => k.nPin > 0).sort((a, b) => b.nPin - a.nPin)
P('site                                              pinners  sole  <=2  allocd   survival%')
for (const k of pinS.slice(0, 25)) {
  P(`${nm(k.rva).slice(0, 46).padEnd(48)} ${String(k.nPin).padStart(7)} ${String(k.nPinSole).padStart(5)} ${String(k.nPinLe2).padStart(4)} ${String(k.nAlloc).padStart(8)} ${(100 * k.nLive / Math.max(1, k.nAlloc)).toFixed(3).padStart(9)}`)
}
P('')

/* ---- HALF 2: density, per size class ---------------------------------- */
if (BLOCKS && existsSync(BLOCKS)) {
  const b = readFileSync(BLOCKS, 'utf8').split(/\r?\n/)
  const byStride = new Map()
  const chunkOf = new Map()   // stride -> set of chunk-live values seen
  let n = 0, unjoined = 0
  for (const l of b) {
    if (!l.startsWith('B ')) continue
    const f = l.split(' ')
    if (f[4] === 'UNJOINED') { unjoined++; continue }
    n++
    const stride = Number(f[2]), nlive = Number(f[3])
    const birth = Number(f[7]), cens = Number(f[8])
    let e = byStride.get(stride)
    if (!e) { e = { stride, n: 0, bytes: 0, sole: 0, births: [], cens: [] }; byStride.set(stride, e) }
    e.n++; e.bytes += stride
    if (nlive === 1) e.sole++
    e.births.push(birth); e.cens.push(cens)
    if (!chunkOf.has(stride)) chunkOf.set(stride, new Map())
  }
  P('--- HALF 2  the ORACLE: pack the survivors perfectly, per size class ---')
  P('A chunk serves ONE size class, so segregation needs its own chunks per')
  P('class.  65280 = 64 KiB less the 256-byte chunk header zone.')
  P('stride   survivors    bytes   chunks-if-packed   lastchunk-fill   sole')
  const strides = [...byStride.values()].sort((a, b2) => b2.bytes - a.bytes)
  let need = 0
  for (const e of strides) {
    const c = Math.ceil(e.bytes / 65280)
    need += c
    const fill = e.bytes >= 65280 ? (e.bytes % 65280 || 65280) / 65280 : e.bytes / 65280
    P(`${String(e.stride).padStart(6)} ${String(e.n).padStart(11)} ${String(e.bytes).padStart(8)} ${String(c).padStart(18)}   ${(100 * fill).toFixed(1).padStart(13)}%  ${String(e.sole).padStart(5)}`)
  }
  const held = Number(meta['WALK.chunks'])
  P(`TOTAL  survivors ${n} in ${byStride.size} size classes`)
  P(`chunks actually held             ${held}`)
  P(`chunks a PERFECT predictor needs ${need}   (${(100 * need / held).toFixed(1)}% of held)`)
  P(`so the compaction headroom is    ${held - need} chunks = ${((held - need) * 65536 / 1048576).toFixed(2)} MiB of chunk address space`)
  P(`classes whose WHOLE survivor set does not fill one chunk: ${strides.filter((e) => e.bytes < 65280).length} of ${strides.length}`)
  {
    const sub = strides.filter((e) => e.bytes < 65280)
    const subB = sub.reduce((a, e) => a + e.bytes, 0)
    P(`  ... those ${sub.length} classes hold ${sub.reduce((a, e) => a + e.n, 0)} survivors / ${subB} bytes, and would occupy ${sub.length} chunks = ${(sub.length * 65536 / 1048576).toFixed(2)} MiB at ${(100 * subB / Math.max(1, sub.length * 65280)).toFixed(1)}% fill`)
  }
  if (unjoined) P(`UNJOINED live blocks (not in the birth table): ${unjoined}`)
  P('')

  /* age structure of the pinners */
  const all = []
  for (const e of strides) for (const c of e.cens) all.push(c)
  all.sort((a, b2) => a - b2)
  const q = (p) => all[Math.min(all.length - 1, Math.floor(p * all.length))]
  P('--- how old are the pinners (allocations since birth, censored at exit) ---')
  P(`n=${all.length}  min=${all[0]}  p10=${q(0.1)}  p50=${q(0.5)}  p90=${q(0.9)}  max=${all[all.length - 1]}`)
  P(`the clock ran to ${meta['CLOCK.seq']}, so p50 of the pinners was born at ${(100 * (1 - q(0.5) / Number(meta['CLOCK.seq']))).toFixed(1)}% of the way through the run`)
  P('')
}

console.log(out.join('\n'))
