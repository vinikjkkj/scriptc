/* THE FALSIFIER: plant a change in a library and require the build to notice.
 *
 * A per-module IR cache is only as sound as the thing that decides a fragment
 * is still valid, and the failure mode it has is the worst one in this tree:
 * a stale fragment produces a SILENTLY WRONG binary. So the keying layer has
 * to be tested by planting, not by inspection.
 *
 * This exercises the layer the per-module design would build on — the
 * input-fingerprint machinery in frontend/input-tracker.ts, consulted by
 * frontend/early-cache.ts — with the edit shaped to be as hard to notice as
 * an edit can be:
 *
 *   - it is in a LIBRARY, never in the entry, so the entry's bytes are
 *     identical across all three builds;
 *   - it is the SAME LENGTH as the text it replaces, so file size does not
 *     move;
 *   - it changes a string literal, so the module graph, every signature and
 *     every type is unchanged and only the emitted constant differs.
 *
 * Three builds: cold (expect a miss), warm (expect a HIT — otherwise the
 * "notices" result below proves nothing, because a cache that never hits
 * notices everything), then the planted edit (expect a miss). The middle
 * build is the positive control and the test fails without it.
 *
 *   node library-edit-falsifier.mjs <progDir> <entryRel> <libRel> <outDir> <compilerDistDir>
 *
 * The caller owns SCRIPTC_CACHE_DIR and the rest of the environment. The
 * verdict is read from the compiler's own hit/consultation counters, not
 * inferred from wall time.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const [progDir, entryRel, libRel, outDir, compilerDist] = process.argv.slice(2)
if (!compilerDist) {
  console.error('usage: node library-edit-falsifier.mjs <progDir> <entryRel> <libRel> <outDir> <compilerDistDir>')
  process.exit(2)
}
/* IN-PROCESS, and that is not a convenience. The compiler reports its cache
 * pair only when ONE process consulted the cache at least twice
 * (early-cache.ts: a one-off CLI build must not append a line to every user's
 * stderr). Four separate `scriptc build` runs would therefore report nothing
 * at all, and a falsifier whose instrument is silent is a falsifier that
 * passes by default. */
const dist = resolve(compilerDist)
const { compile } = await import(pathToFileURL(join(dist, 'index.js')).href)
const { earlyCacheCounters } = await import(pathToFileURL(join(dist, 'frontend', 'early-cache.js')).href)

const libPath = join(progDir, libRel)
const original = readFileSync(libPath)

async function build(tag) {
  const before = earlyCacheCounters()
  try {
    await compile(join(progDir, entryRel), { outDir, outPath: join(outDir, 'p.exe') })
  } catch (e) {
    console.log(`  ${tag.padEnd(14)} build threw: ${String(e).slice(0, 120)}`)
  }
  const after = earlyCacheCounters()
  const r = { hit: after.hits > before.hits, consulted: after.consultations > before.consultations }
  console.log(`  ${tag.padEnd(14)} consulted=${r.consulted}  hit=${r.hit}`)
  return r
}

/** A same-length replacement inside the library's first string literal, in
 *  whichever of the three quotings appears first. */
function plant(text) {
  for (const q of ['"', "'", '`']) {
    const i = text.indexOf(q)
    const j = i < 0 ? -1 : text.indexOf(q, i + 1)
    if (j < 0 || j - i < 2) continue
    const body = text.slice(i + 1, j)
    const flipped = [...body].map((c) => (c === 'z' ? 'q' : c === 'a' ? 'b' : c === 'b' ? 'a' : c === 'q' ? 'z' : c)).join('')
    if (flipped === body) continue
    return { text: text.slice(0, i + 1) + flipped + text.slice(j), from: body, to: flipped }
  }
  throw new Error('library has no plantable string literal; point at another file')
}

console.log('three builds, one library edit:')
const cold = await build('cold')
const warm = await build('warm')
const before = original.toString('utf8')
const { text: after, from, to } = plant(before)
if (Buffer.byteLength(after) !== original.length) throw new Error('planted edit changed the file length; it must not')
writeFileSync(libPath, after)
let planted
try { planted = await build('planted') } finally { writeFileSync(libPath, original) }

console.log(`\nplanted: ${libRel}  "${from}" -> "${to}"  (same length, library only)`)
const ok = []
const fail = []
;(warm.hit ? ok : fail).push('the warm rebuild HIT (without this the miss below proves nothing)')
;(planted.consulted && !planted.hit ? ok : fail).push('the planted edit MISSED')
;(!cold.hit ? ok : fail).push('the cold build did not hit')
for (const s of ok) console.log(`  PASS  ${s}`)
for (const s of fail) console.log(`  FAIL  ${s}`)
process.exit(fail.length === 0 ? 0 : 1)
