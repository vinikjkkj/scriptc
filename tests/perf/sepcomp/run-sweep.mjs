/* The entry-perturbation sweep, end to end.
 *
 * WHAT IT ASKS. If a build's library IR is a function of the library and not
 * of the entry, then editing the entry must leave every non-entry function
 * alone. This builds each multi-module corpus program twice — once from its
 * own entry, once from an entry that is those same bytes plus an appended
 * block — and compares the two IR dumps function by function.
 *
 * WHAT COUNTS AS "ALONE". Identical up to POSITIONAL ids: shape ids, union
 * ids, and the counter-named lifted and interned helpers (`%fn12`,
 * `%obj.keys.3`, `%C.m%0`). Those are minted in first-seen order over the
 * whole program, so an entry that mints one of its own shifts every id after
 * it — a renaming, not a different program. Source locations are stripped for
 * the same reason.
 *
 * WHAT IS EXCLUDED, AND WHY. A program in which some module imports the ENTRY
 * by name is not one program under an entry edit: building `main_pert.ts`
 * pulls `main.ts` in as an extra module, so the two arms are two different
 * graphs. entry-backedge.mjs finds those mechanically.
 *
 *   node run-sweep.mjs <corpusDir> <workDir> <cliMainJs>
 *
 * Environment the caller owns (this script sets none of it): TMP outside the
 * worktree, SCRIPTC_CACHE_DIR, SCRIPTC_TARGET, SCRIPTC_CC, and a `zig` on
 * PATH. A stub `zig` that refuses is enough and is much faster: the emitter
 * writes the TU and the IR dump before the native stage runs, so a toolchain
 * that refuses still leaves both on disk.
 */
import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const [corpus, work, cli] = process.argv.slice(2)
if (!corpus || !work || !cli) {
  console.error('usage: node run-sweep.mjs <corpusDir> <workDir> <cliMainJs>')
  process.exit(2)
}
const progs = join(work, 'progs'), out = join(work, 'out')
const node = process.execPath

const run = (script, args) => execFileSync(node, [join(here, script), ...args], { encoding: 'utf8' })

console.log(run('entry-perturbation-prep.mjs', [corpus, progs]).trim())
const excluded = run('entry-backedge.mjs', [progs]).trim()
console.log(excluded)
const excludeList = excluded.split('\n').filter((l) => l.includes('\t')).map((l) => l.split('\t')[0])

mkdirSync(out, { recursive: true })
const rows = readFileSync(join(progs, 'PROGRAMS.tsv'), 'utf8').trim().split('\n').map((l) => l.split('\t'))
let i = 0
for (const [name, base, pert] of rows) {
  i++
  for (const [arm, file] of [['base', base], ['pert', pert]]) {
    const dir = join(out, name, arm)
    mkdirSync(dir, { recursive: true })
    let log = ''
    try {
      log = execFileSync(node, [cli, 'build', join(progs, name, file), '-o', join(dir, 'prog.exe'), '--emit-ir', '--keep-c'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
    } catch (e) { log = String(e.stdout ?? '') + String(e.stderr ?? '') }
    writeFileSync(join(dir, 'build.log'), log)
  }
  if (i % 10 === 0) console.log(`  ${i}/${rows.length}`)
}
console.log(run('entry-perturbation-compare.mjs', [out, excludeList.join(',')]))
