/**
 * cpuprof-top.mjs - top SELF-time functions from a Node --cpu-prof profile.
 *
 * The node half of the function table. The compiled half comes from
 * exe-profile.mjs --cputime (exact per-function self cycles on the SHIPPED
 * Windows binary) or from callgrind on a linux cross build (exact
 * instruction counts, but valgrind answers CPUID SHA=0 so every
 * SHA-dispatched call takes its scalar fallback -- those rows have to be
 * read separately).
 *
 * Self time is hitCount * (profile duration / total hits): V8's sampler
 * charges one hit per sample to the leaf frame, so hits are proportional
 * to self time by construction.
 *
 *   node cpuprof-top.mjs <file.cpuprofile> [topN]
 */
import { readFileSync } from 'node:fs'

const file = process.argv[2]
const topN = Number(process.argv[3] ?? '25')
const p = JSON.parse(readFileSync(file, 'utf8'))

const durUs = p.endTime - p.startTime
const byNode = new Map(p.nodes.map((n) => [n.id, n]))

// hitCount is authoritative when present; fall back to counting samples.
let totalHits = 0
const hits = new Map()
for (const n of p.nodes) {
  const h = n.hitCount ?? 0
  if (h > 0) { hits.set(n.id, h); totalHits += h }
}
if (totalHits === 0) {
  for (const id of p.samples ?? []) { hits.set(id, (hits.get(id) ?? 0) + 1); totalHits++ }
}

const label = (n) => {
  const f = n.callFrame ?? {}
  const name = f.functionName && f.functionName.length > 0 ? f.functionName : '(anonymous)'
  let url = f.url ?? ''
  url = url.replace(/^file:\/\/\//, '').split(String.fromCharCode(92)).join('/')
  const short = url.split('/').slice(-2).join('/')
  return `${name}  ${short}${f.lineNumber >= 0 ? ':' + (f.lineNumber + 1) : ''}`
}

const agg = new Map()
for (const [id, h] of hits) {
  const n = byNode.get(id)
  if (!n) continue
  const k = label(n)
  agg.set(k, (agg.get(k) ?? 0) + h)
}

const rows = [...agg.entries()].sort((a, b) => b[1] - a[1])
console.log(`profile ${file}`)
console.log(`duration ${(durUs / 1000).toFixed(0)} ms, ${totalHits} samples`)
console.log(`${'self%'.padStart(7)} ${'self_ms'.padStart(9)}  function`)
let cum = 0
for (const [k, h] of rows.slice(0, topN)) {
  const pct = (h / totalHits) * 100
  cum += pct
  console.log(`${pct.toFixed(2).padStart(7)} ${((h / totalHits) * durUs / 1000).toFixed(1).padStart(9)}  ${k}`)
}
console.log(`top ${Math.min(topN, rows.length)} = ${cum.toFixed(1)}% of samples`)

// ── non-idle view ─────────────────────────────────────────────────────
// --cpu-prof covers the whole process lifetime, so `(idle)` swamps any
// phase that waits. Shares of ACTUAL COMPUTE are what a reader wants, and
// the subsystem rollup is what answers "is it protobuf or is it crypto".
const IDLE = new Set(['(idle)', '(program)', '(root)', '(garbage collector)'])
const isIdle = (k) => IDLE.has(k.split('  ')[0])
const busy = rows.filter(([k]) => !isIdle(k))
const busyTotal = busy.reduce((a, [, h]) => a + h, 0)
console.log('')
console.log(`non-idle samples ${busyTotal} (${((busyTotal / totalHits) * 100).toFixed(1)}% of ${totalHits})`)
console.log(`${'busy%'.padStart(7)}  function`)
for (const [k, h] of busy.slice(0, topN)) {
  console.log(`${((h / busyTotal) * 100).toFixed(2).padStart(7)}  ${k}`)
}
const SUBS = [
  ['curve25519 / field arith', /math\/(fe|edwards|montgomery)|core\/xeddsa|curve/i],
  ['protobuf                ', /proto\/|protobuf|waproto/i],
  ['node:crypto KeyObject / DH  ', /crypto\/(keys|diffiehellman|keygen)|KeyObject/i],
  ['node:crypto hash/hkdf/cipher', /crypto\/(hkdf|hash|cipher|random|sig)/i],
  ['zapo messaging/coordinators', /coordinators\/|messaging\/|signal\/|session/i],
  ['module loading / tsx    ', /cjs\/loader|esm\/hooks|wrapSafe|PackageJSON|tsx/i],
]
console.log('')
console.log('subsystem rollup (share of non-idle):')
const seen = new Set()
for (const [name, re] of SUBS) {
  let h = 0
  for (const [k, v] of busy) if (re.test(k)) { h += v; seen.add(k) }
  console.log(`  ${((h / busyTotal) * 100).toFixed(2).padStart(6)}%  ${name}`)
}
let other = 0
for (const [k, v] of busy) if (!seen.has(k)) other += v
console.log(`  ${((other / busyTotal) * 100).toFixed(2).padStart(6)}%  everything else`)
