/* uncoded-sweep.mjs — every refusal the compiler can put into a PROGRAM
 * without an SC code, found in the EMITTER rather than in emitted output.
 *
 *   node uncoded-sweep.mjs <compiler-src-dir> [emitted-dir ...] [--selftest]
 *
 * Why the search runs over the emitter and not over emitted C: a scan for a
 * string you already know can only ever find that string. This enumerates the
 * CHANNELS instead, so a second message template shows up as a new hit.
 *
 * The CODED channels, deliberately excluded:
 *   - IR node `runtimeFence` (nodes.ts, `code: string`), emitted as
 *     scr_throw_error_msg_code(..., "SCxxxx")   [emit-stmts.ts]
 *   - scr_fence_fatal(msg, len, code)
 *   - scr_throw_lowering_fence (the pre-rendered ladder fence)
 *   - L.noLowering(...) / L.unsupported("SCxxxx", ...) — compile-time
 * A compiler-limitation message that reaches the program by any OTHER route
 * is UNCODED, and no SC census can see it.
 *
 * THREE NEGATIVE CONTROLS, all of which the first version of this sweep got
 * wrong and reported as uncoded refusals:
 *   lower-emitter.ts  an L.noLowering hint using the same vocabulary
 *   lower-stmts.ts    L.unsupported("SC1031", ...) — coded, and the code is
 *                     a literal in the call
 *   lower-sqlite.ts   the DB_REFUSALS / STMT_REFUSALS hint TABLES, whose
 *                     entries sit a dozen lines from an unrelated `strLit`
 *                     helper. A proximity window alone cannot tell a hint
 *                     table from an IR construction, so the table itself has
 *                     to be recognised.
 * --selftest asserts the known lower-island.ts site IS found and that none of
 * the three controls is. Without the controls this sweep reported 6 sites and
 * still printed "selftest ok" — a false green.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, extname } from 'node:path'

/* Vocabulary only a compiler-limitation message uses. Node-parity errors
 * ("Reduce of empty array…", "Cannot read properties of undefined…") never
 * mention the build, the flags, or lowering. */
const LIMITATION =
  /this build does not include|compile it statically|--npm-static|build with --dynamic|no scriptc lowering|has no lowering|no static lowering/

/* Channels that put a string INTO the program. */
const RUNTIME_CHANNEL = /fn:\s*"error\.new"|fn:\s*"error\.newDom"|name:\s*"promise\.reject"|kind:\s*"strLit"/

/* Channels that make it a compile-time diagnostic instead. */
const CODED_CHANNEL =
  /noLowering\(|unsupported\(|refuse\(|"SC\d{4}"|runtimeFence|scr_fence_fatal|scr_throw_lowering_fence|ladderFenceExpr|scr_throw_error_msg_code/

/* A hint TABLE — `const NAME: Record<string, string> = { … }` — holds text
 * that some later noLowering() call will pass as its hint. Its entries are
 * not IR. Returns the set of line indices (0-based) covered by such tables. */
function hintTableLines(lines) {
  const covered = new Set()
  let depth = 0
  let inTable = false
  for (let i = 0; i < lines.length; i++) {
    if (!inTable && /^\s*const\s+\w+\s*:\s*Record<string,\s*string>\s*=\s*\{/.test(lines[i])) {
      inTable = true
      depth = 0
    }
    if (inTable) {
      covered.add(i)
      for (const ch of lines[i]) {
        if (ch === '{') depth++
        else if (ch === '}') depth--
      }
      if (depth <= 0 && /\}/.test(lines[i])) inTable = false
    }
  }
  return covered
}

function walk(p, out, exts) {
  const st = statSync(p)
  if (st.isDirectory()) for (const n of readdirSync(p)) walk(join(p, n), out, exts)
  else if (exts.test(p)) out.push(p)
}

function sweep(root) {
  const files = []
  walk(root, files, /\.ts$/)
  const hits = []
  for (const f of files) {
    const lines = readFileSync(f, 'utf8').split('\n')
    const tables = hintTableLines(lines)
    for (let i = 0; i < lines.length; i++) {
      if (!LIMITATION.test(lines[i])) continue
      if (/^\s*(\/\/|\*|\/\*)/.test(lines[i])) continue // prose about a message
      if (tables.has(i)) continue // a hint table entry, not IR
      const window = lines.slice(Math.max(0, i - 12), Math.min(lines.length, i + 14)).join('\n')
      if (RUNTIME_CHANNEL.test(window) && !CODED_CHANNEL.test(window)) {
        hits.push({ file: f.replace(/\\/g, '/'), line: i + 1, text: lines[i].trim().slice(0, 110) })
      }
    }
  }
  return hits
}

const root = process.argv[2]
if (root === undefined) {
  console.error('usage: uncoded-sweep.mjs <compiler-src-dir> [emitted-dir ...] [--selftest]')
  process.exit(2)
}
const hits = sweep(root)
const sites = new Set(hits.map((h) => h.file))
console.log(`UNCODED refusal construction sites: ${hits.length} line(s) in ${sites.size} file(s)`)
for (const h of hits) console.log(`  ${h.file}:${h.line}\n      ${h.text}`)

if (process.argv.includes('--selftest')) {
  let bad = false
  if (!hits.some((h) => h.file.includes('lowering/lower-island.ts'))) {
    console.error('SELFTEST FAILED: the known lower-island.ts site was not found — the sweep is blind')
    bad = true
  }
  const NEGATIVE = ['lowering/lower-emitter.ts', 'lowering/lower-stmts.ts', 'lowering/lower-sqlite.ts']
  for (const n of NEGATIVE) {
    if (hits.some((h) => h.file.includes(n))) {
      console.error(`SELFTEST FAILED: ${n} is a CODED diagnostic and was reported as an uncoded refusal`)
      bad = true
    }
  }
  if (bad) process.exit(3)
  console.error('selftest ok: the known uncoded site is found; all three coded controls are rejected')
}

/* Second half: how many INSTANCES of the template each emitted artifact
 * carries, and for which specifiers. One site, many specifiers. */
for (const dir of process.argv.slice(3).filter((a) => !a.startsWith('--'))) {
  const specs = new Map()
  const files = []
  walk(dir, files, /\.(c|scrh|ll)$/)
  for (const f of files) {
    const s = readFileSync(f, 'latin1')
    for (const m of s.matchAll(/Cannot load module '([^']+)'/g)) specs.set(m[1], (specs.get(m[1]) ?? 0) + 1)
  }
  console.log(`\n${dir}: ${specs.size} uncoded module refusal(s) over ${files.length} emitted file(s)`)
  for (const [k, v] of specs) console.log(`  ${k} x${v}`)
}
