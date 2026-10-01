/* Read a SCRIPTC_LOWER_PROFILE jsonl and report what a per-module cache
 * could and could not reach.
 *
 * Three populations, and the whole point is to keep them apart:
 *
 *   COLLECTION      %discovery-collect / %emit-collect. Whole-program work
 *                   that runs before the first body: splitFiles,
 *                   collectProgram, prepareModuleInits. No module owns it,
 *                   so no per-module fragment can be keyed to it.
 *   ATTRIBUTED      D:/Q: (discovery) and B:/I:/G: (emit). One file each.
 *                   This is the population a per-module cache can reach.
 *   RESIDUAL        pass total minus the two above. Named rather than
 *                   folded into either, because a cache that silently
 *                   counted it as reachable would overstate its own prize.
 *
 * It also splits ATTRIBUTED into the ENTRY's share and everything else,
 * which is the actual ceiling on an edited-entry rebuild: the entry is
 * re-lowered on every such build by construction.
 */
import { readFileSync } from 'node:fs'

/* THE ENTRY IS NAMED, NEVER INFERRED FROM COST.
 *
 * This file inferred it from the heaviest attributed bucket -- the defect
 * already found and fixed in attrib-decide.mjs, and left unfixed HERE
 * because the correction was filed under the tool it was found in rather
 * than under the property it protects.
 *
 * It then failed the same way, twice over. walkfuse made the entry cheaper
 * than a library; the type-formatting fix made it nearly free (3.2 s). So
 * the heaviest file became spec/proto/index.js at 105.4 s, and C came out
 * 136.3 s where it is 238.6 s -- wrong by 43%, in the direction that makes
 * the cache look WORSE. Required argument now, and an unmatched pattern
 * raises rather than defaulting. */
const f = process.argv[2]
const entryRe = process.argv[3]
if (!f || !entryRe) {
  console.error('usage: node collect-split.mjs <lower-profile.jsonl> <entryRegex>')
  process.exit(2)
}
const entryPattern = new RegExp(entryRe)
const recs = readFileSync(f, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l))
const s = (x) => (x / 1000).toFixed(1) + 's'
const pct = (a, b) => (100 * a / b).toFixed(1) + '%'

for (const o of recs) {
  const disc = o['%discovery'] ?? 0
  const em = o['%emit-run'] ?? 0
  if (disc + em === 0) continue
  // NOT-TAPPED IS NOT ZERO. The collection buckets exist only on branches
  // that carry the collection tap; a log from a branch without it has no
  // such key, and printing 0.0s for that is a zero produced by a MISSING
  // INSTRUMENT -- the exact shape this block already retracted a finding
  // over (2f34c87ac: an older log's unprefixed per-file keys read as a
  // bucket prefix). With a build/don't-build decision hanging on the
  // number, the report has to say which of the two it is.
  const hasCollectionTap = '%discovery-collect' in o || '%emit-collect' in o
  const dCol = o['%discovery-collect'] ?? 0
  const eCol = o['%emit-collect'] ?? 0
  // The entry is the file the emit pass spent the most B:/I: time in; naming
  // it by the most-expensive bucket rather than by a path pattern keeps this
  // honest across programs whose entry is not called zapo-rest.ts.
  const byFile = new Map()
  let dAttr = 0, eAttr = 0
  for (const [k, v] of Object.entries(o)) {
    const m = /^([DQBIG]):(.*)$/.exec(k)
    if (!m) continue
    const pass = m[1] === 'D' || m[1] === 'Q' ? 'd' : 'e'
    if (pass === 'd') dAttr += v; else eAttr += v
    const cur = byFile.get(m[2]) ?? { d: 0, e: 0 }
    cur[pass] += v
    byFile.set(m[2], cur)
  }
  const ranked = [...byFile].sort((a, b) => (b[1].d + b[1].e) - (a[1].d + a[1].e))
  const named = [...byFile].filter(([f]) => entryPattern.test(f))
  if (named.length === 0) {
    throw new Error(`no attributed file matches ${entryPattern}. C is attributed-minus-entry, so an ` +
      `unmatched entry would silently make C the whole attributed total.`)
  }
  const entryName = named.map(([f]) => f).join(' + ')
  const entryT = named.reduce((a, [, t]) => ({ d: a.d + t.d, e: a.e + t.e }), { d: 0, e: 0 })
  const attributed = dAttr + eAttr
  const collection = dCol + eCol
  const total = disc + em
  const residual = total - attributed - collection
  const entry = entryT.d + entryT.e
  const cacheable = attributed - entry

  console.log(`\n==== lowering total ${s(total)}  (discovery ${s(disc)} / emit ${s(em)}) ====`)
  console.log(hasCollectionTap
    ? `COLLECTION   ${s(collection).padStart(8)}  ${pct(collection, total).padStart(6)}   discovery ${s(dCol)}  emit ${s(eCol)}`
    : `COLLECTION    NOT TAPPED -- this log's branch has no %discovery-collect/%emit-collect. It is folded into RESIDUAL below, and it is NOT zero.`)
  console.log(`ATTRIBUTED   ${s(attributed).padStart(8)}  ${pct(attributed, total).padStart(6)}   discovery ${s(dAttr)}  emit ${s(eAttr)}   files=${byFile.size}`)
  console.log(`RESIDUAL     ${s(residual).padStart(8)}  ${pct(residual, total).padStart(6)}   ` +
    (hasCollectionTap ? '(neither collection nor a file)' : '(INCLUDES collection, which this branch does not tap)'))
  console.log(`\nheaviest file (the entry): ${entryName}`)
  console.log(`  entry attributed    ${s(entry)}   = ${pct(entry, attributed)} of attributed, ${pct(entry, total)} of lowering`)
  console.log(`  NON-ENTRY attributed ${s(cacheable)}  = ${pct(cacheable, total)} of lowering`)
  console.log('')
  console.log(`C = NON-ENTRY ATTRIBUTED LOWERING = ${s(cacheable)}`)
  console.log('This is the decision number, in SECONDS rather than as a share: the threshold')
  console.log('it is compared against (120 s of wall on an edited-entry rebuild) is absolute.')
  console.log('Compare C between two branches measured in the SAME session with the SAME tap.')
  console.log('Comparing against an archived C from an earlier session reopens 2f34c87ac.')
  console.log(`\ntop 8 files by attributed time:`)
  for (const [name, t] of ranked.slice(0, 8)) {
    console.log(`  ${s(t.d + t.e).padStart(8)}  D+Q=${s(t.d).padStart(7)} B+I+G=${s(t.e).padStart(7)}  ${name}`)
  }
}
