/* verify-arm.mjs <record.json> <expectedProvRoot> [<patchedRelPath> <line> <expectedText>]
 *
 * A POSITIVE CONTROL for the arm rig itself. An arm that silently reads the
 * WRONG tree produces a perfect 0-cleared/0-added, which reads exactly like
 * "this line is not the cause" -- and that is what happened here: run-sites.ps1
 * sourced env.ps1 on its first line and reset the caller's cache override, so
 * six arms all measured the unpatched tree.
 *
 * This asserts, from the RECORD (not from the launcher's intentions):
 *   1. at least one blocker site's path is under the expected provenance root;
 *   2. NO site path is under any other provenance root;
 *   3. optionally, that the patched file on disk really carries the new text.
 * Exits non-zero and says which check failed.
 */
import { readFileSync } from 'node:fs'

const [rec_, root_, rel, lineS, expect] = process.argv.slice(2)
if (!rec_ || !root_) { console.error('usage: node verify-arm.mjs <record.json> <expectedProvRoot> [<rel> <line> <text>]'); process.exit(1) }
const rec = JSON.parse(readFileSync(rec_, 'utf8'))
const root = root_.replace(/\\/g, '/').replace(/\/$/, '')

const sites = rec.sites.filter((s) => s.section === 'blocker')
if (sites.length === 0) { console.error('VERIFY FAILED: record has no blocker sites at all'); process.exit(2) }

const provPaths = new Set()
for (const s of sites) {
  const m = s.file.match(/^(.*?)\/[0-9a-f]{40}\//)
  if (m) provPaths.add(m[1])
}
if (provPaths.size === 0) { console.error('VERIFY FAILED: no site resolves to a provenance checkout'); process.exit(3) }
const wrong = [...provPaths].filter((p) => p.replace(/\\/g, '/') !== root)
if (wrong.length > 0) {
  console.error('VERIFY FAILED: the record read a provenance root that is not the arm root')
  console.error('  expected: ' + root)
  for (const w of wrong) console.error('  found   : ' + w)
  process.exit(4)
}
console.error(`verify-arm ok: ${sites.length} blocker sites, all under ${root}`)

if (rel && lineS && expect !== undefined) {
  const p = `${root_}/${rel}`
  const got = readFileSync(p, 'utf8').split(/\r?\n/)[Number(lineS) - 1]
  if (got !== expect) {
    console.error(`VERIFY FAILED: ${rel}:${lineS} on disk is not the patched text`)
    console.error(`  expected: ${JSON.stringify(expect)}`)
    console.error(`  found   : ${JSON.stringify(got)}`)
    process.exit(5)
  }
  console.error(`verify-arm ok: ${rel}:${lineS} carries the arm's edit`)
}
