/* The decision, computed once from the four samples, with the rule stated
 * in the code rather than applied by hand afterwards.
 *
 *     build the fragment if   C >= 12.8% of T
 *
 * C is NON-ENTRY ATTRIBUTED LOWERING; T is the build's wall to the link
 * refusal. 12.8% is 120s/936s -- the absolute threshold committed before any
 * data, restated as a ratio because the machine is not quiet and both C and
 * T inflate together under load. Both forms are printed. The ratio is the
 * rule whenever T is materially above the 936 s reference, and that is
 * decided here, in advance, not after seeing the number.
 *
 * Arms are averaged over their two passes (A,B,B,A), which is what the
 * rotation buys: a first-position penalty lands once on each arm instead of
 * once on one of them.
 */
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const [logDir, wallsTsv, entryRe] = process.argv.slice(2)
// The entry, as a regex over the attributed file keys. Required: inferring it
// from cost is the defect this argument exists to remove.
if (!entryRe) { console.error('usage: attrib-decide.mjs <logDir> <walls.tsv> <entryRegex>'); process.exit(2) }
const entryPattern = new RegExp(entryRe)
const REFERENCE_T = 936
const THRESHOLD_RATIO = 120 / REFERENCE_T

const walls = new Map()
for (const line of readFileSync(wallsTsv, 'utf8').split(/\r?\n/)) {
  const [tag, pass, secs] = line.split('\t')
  if (tag && pass) walls.set(`${tag}${pass}`, Number(secs))
}

/** C from one profile: attributed lowering minus the heaviest file's share.
 * The heaviest file IS the entry, named by cost rather than by a path
 * pattern, so the same reader works on any program. */
function readC(file, entryPattern) {
  const o = JSON.parse(readFileSync(file, 'utf8').trim().split('\n')[0])
  // MEASURED-ZERO IS NOT NEVER-WRITTEN, and `?? 0` cannot tell them apart.
  // The default is the trap, not the bug: a branch missing a bucket reads 0,
  // the arithmetic below still runs, and a verdict comes out of a number
  // nobody measured. This has now bitten three separate counters in one day
  // -- a phase bucket, a fence count, and a neighbouring block's token count
  // whose arm-A control passed for the wrong reason. So the decision reader
  // REQUIRES its inputs and says which one is missing.
  const need = (k) => {
    if (!(k in o)) {
      throw new Error(
        `${file}: bucket ${k} was never written, which is not the same as measuring zero. ` +
        `This log's branch does not carry that tap, so C cannot be computed from it. ` +
        `Both arms must be measured with the same instrument (the five D/Q/B/I/G buckets ` +
        `from c1a7ed74f, an ancestor of both).`)
    }
    return o[k]
  }
  const disc = need('%discovery'), em = need('%emit-run')
  const byFile = new Map()
  let attributed = 0
  for (const [k, v] of Object.entries(o)) {
    const m = /^([DQBIG]):(.*)$/.exec(k)
    if (!m) continue
    attributed += v
    byFile.set(m[2], (byFile.get(m[2]) ?? 0) + v)
  }
  const ranked = [...byFile].sort((a, b) => b[1] - a[1])
  // Same rule one level down: no attributed file at all means the per-file
  // taps did not fire, and `entry = 0` would silently make C equal the whole
  // attributed total -- the most optimistic possible answer, from no data.
  // THE ENTRY IS NAMED, NEVER INFERRED FROM COST.
  //
  // This read `entry = ranked[0][1]` -- the heaviest attributed file -- and
  // that was true in the data it was written against and FALSE in the data
  // it was written for. walkfuse's memo cut the entry 17x, from 380.7s to
  // 21.9s, so on that arm the heaviest file became a LIBRARY (proto/index.js)
  // and the reporter subtracted it as though it were the entry: the entry's
  // cost stayed inside C and a library's was removed from it. C read 193.6s
  // where it is 250.3s.
  //
  // Same family as the 95.9% hit rate that removed 0.7% of the work, and as
  // phi: a relationship measured in one regime carried into another. Note it
  // biased AGAINST the hypothesis here, where `?? 0` biased for it -- so the
  // direction is not the tell. A DERIVED IDENTITY needs the same suspicion as
  // a derived number.
  const named = [...byFile.keys()].filter((f) => entryPattern.test(f))
  if (named.length === 0) {
    throw new Error(
      `${file}: no attributed file matches the entry pattern ${entryPattern}. ` +
      `C is attributed-minus-entry, so an unmatched entry would silently make C ` +
      `the whole attributed total. The entry is named, never inferred from cost.`)
  }
  const entry = named.reduce((sum, f) => sum + byFile.get(f), 0)
  return { lowering: disc + em, attributed, entry, C: attributed - entry, files: byFile.size }
}

const rows = []
for (const f of readdirSync(logDir).filter((n) => /^attrib-[AB]-p\d\.jsonl$/.test(n)).sort()) {
  const m = /^attrib-([AB])-p(\d)\.jsonl$/.exec(f)
  const r = readC(join(logDir, f), entryPattern)
  const T = walls.get(`${m[1]}${m[2]}`) ?? NaN
  rows.push({ arm: m[1], pass: Number(m[2]), T, ...r })
}

const s = (x) => (x / 1000).toFixed(1) + 's'
console.log('arm pass       T        lowering   attributed    entry        C         C/T')
for (const r of rows) {
  console.log(
    ` ${r.arm}   ${r.pass}    ${(r.T.toFixed(1) + 's').padStart(8)}  ${s(r.lowering).padStart(9)}  ${s(r.attributed).padStart(10)}  ${s(r.entry).padStart(9)}  ${s(r.C).padStart(9)}  ${(100 * (r.C / 1000) / r.T).toFixed(1)}%`)
}

const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length
for (const arm of ['A', 'B']) {
  const rs = rows.filter((r) => r.arm === arm)
  if (rs.length === 0) continue
  const C = mean(rs.map((r) => r.C)) / 1000
  const T = mean(rs.map((r) => r.T))
  console.log(`\narm ${arm}  mean over ${rs.length} pass(es):  C = ${C.toFixed(1)}s   T = ${T.toFixed(1)}s   C/T = ${(100 * C / T).toFixed(1)}%`)
}

const A = rows.filter((r) => r.arm === 'A'), B = rows.filter((r) => r.arm === 'B')
if (A.length && B.length) {
  const CA = mean(A.map((r) => r.C)) / 1000, CB = mean(B.map((r) => r.C)) / 1000
  const TA = mean(A.map((r) => r.T)), TB = mean(B.map((r) => r.T))
  console.log(`\nratio  C_B/C_A = ${(CB / CA).toFixed(3)}    T_B/T_A = ${(TB / TA).toFixed(3)}    (X, the frontend-lane factor, is 1/(T_B/T_A) = ${(TA / TB).toFixed(2)})`)
  const ratio = CB / TB
  const inflated = TB > REFERENCE_T * 1.1
  console.log(`\nDECISION on arm B (the compiler that will ship):`)
  console.log(`  C = ${CB.toFixed(1)}s   threshold as declared = 120s absolute  -> ${CB >= 120 ? 'PASS' : 'FAIL'}`)
  console.log(`  C/T = ${(100 * ratio).toFixed(1)}%   threshold = ${(100 * THRESHOLD_RATIO).toFixed(1)}%  -> ${ratio >= THRESHOLD_RATIO ? 'PASS' : 'FAIL'}`)
  console.log(`  T = ${TB.toFixed(1)}s vs the ${REFERENCE_T}s reference -> ${inflated ? 'MATERIALLY INFLATED: the RATIO is the rule' : 'comparable: both forms agree or the absolute governs'}`)
  const verdict = inflated ? ratio >= THRESHOLD_RATIO : (CB >= 120)
  console.log(`\nVERDICT  ${verdict ? 'BUILD the fragment' : 'DO NOT build the fragment'}`)
}
