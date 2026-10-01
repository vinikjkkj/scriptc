/* C AND REACHABLE, IN ONE TABLE, IN SECONDS.
 *
 * Two numbers born in two different reports, which is exactly the pair
 * nobody is assigned to multiply:
 *
 *   C             non-entry attributed lowering -- what a per-module
 *                 fragment COULD reach. A ceiling, in seconds, from the
 *                 SCRIPTC_LOWER_PROFILE attribution.
 *   reachable     which of those modules a fragment may actually be used
 *                 for, from the SCRIPTC_FRAGMENT_CENSUS module outcomes.
 *
 * THE CENSUS COUNTS MODULES AND C IS SECONDS. Reporting "87% of modules
 * cacheable" against a seconds decision would be a ratio measured in one
 * denominator and spent in another -- the error family this block spent a
 * day removing. One library file on this program, spec/proto/index.js, was
 * 220 s of 1156 s attributed: a handful of refusals among the expensive
 * modules can cost more than a hundred cheap ones.
 *
 * So every cacheable module is weighted by its own attributed seconds, and
 * the answer is C_reachable in seconds and as a fraction of T.
 *
 *   node census-weight.mjs <attribution.jsonl> <census.modules.tsv> <T-seconds> <entryRegex>
 */
import { readFileSync } from 'node:fs'

const [profPath, tsvPath, tStr, entryRe] = process.argv.slice(2)
if (!profPath || !tsvPath || !tStr || !entryRe) {
  console.error('usage: census-weight.mjs <attribution.jsonl> <census.modules.tsv> <T-seconds> <entryRegex>')
  process.exit(2)
}
const T = Number(tStr)
const entryPattern = new RegExp(entryRe)

// Per-file attributed milliseconds, from the five buckets present on every
// branch that carries the tap.
const o = JSON.parse(readFileSync(profPath, 'utf8').trim().split('\n')[0])
for (const need of ['%discovery', '%emit-run']) {
  if (!(need in o)) {
    throw new Error(`${profPath}: bucket ${need} was never written. Not the same as measuring zero: ` +
      `this log's branch does not carry the tap, so C cannot be computed from it.`)
  }
}
const attributed = new Map()
for (const [k, v] of Object.entries(o)) {
  const m = /^([DQBIG]):(.*)$/.exec(k)
  if (!m) continue
  attributed.set(m[2], (attributed.get(m[2]) ?? 0) + v)
}
if (attributed.size === 0) throw new Error(`${profPath}: no per-file bucket was written.`)

const outcomes = new Map()
for (const line of readFileSync(tsvPath, 'utf8').split(/\r?\n/)) {
  if (!line.trim()) continue
  const [module, state, codes] = line.split('\t')
  outcomes.set(module, { cacheable: state === 'cacheable', codes: codes ? codes.split(',') : [] })
}
if (outcomes.size === 0) throw new Error(`${tsvPath}: no module rows.`)

// NAME THE ENTRY, never infer it from cost. walkfuse cut the entry 17x, and
// on that arm the heaviest attributed file became a LIBRARY -- a reporter
// that took the heaviest as the entry understated C by 23%.
let entryMs = 0
let cMs = 0
let reachableMs = 0
const refusedHeavy = []
const unmatched = []
for (const [file, ms] of attributed) {
  if (entryPattern.test(file)) { entryMs += ms; continue }
  cMs += ms
  const outcome = outcomes.get(file)
  if (outcome === undefined) { unmatched.push(file); continue }
  if (outcome.cacheable) reachableMs += ms
  else refusedHeavy.push({ file, ms, codes: outcome.codes })
}
if (entryMs === 0) {
  throw new Error(`no attributed file matches the entry pattern ${entryPattern}. C is ` +
    `attributed-minus-entry, so an unmatched entry would silently make C the whole total.`)
}

const s = (ms) => (ms / 1000).toFixed(1) + 's'
const pct = (a, b) => (b === 0 ? 'n/a' : ((100 * a) / b).toFixed(1) + '%')
refusedHeavy.sort((a, b) => b.ms - a.ms)

const modulesTotal = outcomes.size
const modulesCacheable = [...outcomes.values()].filter((x) => x.cacheable).length

console.log('')
console.log('                              modules            seconds        % of T')
console.log(`T (build wall)                                               ${T.toFixed(1)}s`)
console.log(`entry (never cacheable)                        ${s(entryMs).padStart(9)}   ${pct(entryMs, T * 1000)}`)
console.log(`C   = non-entry attributed                     ${s(cMs).padStart(9)}   ${pct(cMs, T * 1000)}   <- the CEILING`)
console.log(`C_reachable = cacheable only   ${String(modulesCacheable).padStart(4)}/${String(modulesTotal).padEnd(5)}  ${s(reachableMs).padStart(9)}   ${pct(reachableMs, T * 1000)}   <- what it DELIVERS`)
console.log('')
console.log(`modules cacheable   ${pct(modulesCacheable, modulesTotal)}   of modules`)
console.log(`C  reachable        ${pct(reachableMs, cMs)}   of C`)
console.log('THE TWO ARE DIFFERENT NUMBERS, and the second is the one the decision needs.')
if (unmatched.length > 0) {
  console.log('')
  console.log(`WARNING: ${unmatched.length} attributed file(s) had no census row, so their time is`)
  console.log('counted in C but in neither cacheable nor refused. C_reachable is a LOWER bound.')
  for (const f of unmatched.slice(0, 5)) console.log('    ' + f)
}

/* MUTUAL COVERAGE: are these two files even from the same build?
 *
 * The attribution and the census are written by the SAME lowerToIr call when
 * both env vars are set -- and by two different builds when they are not.
 * Joining across builds is silent: the numbers are individually true, the
 * table is nonsense, and nothing looks wrong. This is the pair the
 * coordinator named as a condition (the census must run on the main of the
 * moment, with both arms re-measured in one session), and a condition that
 * nothing checks is a hope.
 *
 * The one-directional warning above covers attributed-without-census. This
 * covers the reverse, which is the direction that actually indicates a
 * MISMATCHED PAIR: a census row for a module the attribution never saw means
 * the two builds lowered different module sets. */
const censusOnly = [...outcomes.keys()].filter((m) => !attributed.has(m) && !entryPattern.test(m))
const overlap = outcomes.size - censusOnly.length
if (censusOnly.length > 0) {
  console.log('')
  console.log(`MISMATCH: ${censusOnly.length} of ${outcomes.size} census rows name a module the`)
  console.log('attribution never saw. These two files are probably from DIFFERENT builds, and a')
  console.log('cross-build join is silent: both numbers are true and the table is nonsense.')
  for (const m of censusOnly.slice(0, 5)) console.log('    ' + m)
  if (overlap * 2 < outcomes.size) {
    console.log('')
    console.log('Fewer than half the census rows match. REFUSING to print a verdict from this pair.')
    process.exit(2)
  }
}
if (refusedHeavy.length > 0) {
  console.log('')
  console.log('most expensive REFUSED modules (where the loss actually is):')
  for (const r of refusedHeavy.slice(0, 8)) {
    console.log(`  ${s(r.ms).padStart(9)}  ${r.codes.join(',').padEnd(20)} ${r.file.split(/[\\/]/).slice(-2).join('/')}`)
  }
}
console.log('')
console.log(`DECISION: the ratio governs for any T, at 12.8%. C_reachable/T = ${pct(reachableMs, T * 1000)} -> ` +
  (reachableMs / 1000 / T >= 120 / 936 ? 'PASS' : 'FAIL'))
