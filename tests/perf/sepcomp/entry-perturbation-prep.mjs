/* Build the entry-perturbation sweep working tree.
 *
 * For every MULTI-MODULE corpus program (a directory with a main.* entry and
 * at least one sibling source), copy the directory and write a second entry
 * beside the first whose only difference is an appended block. The block is
 * not a no-op on purpose: it mints a record shape, a lambda, an interned
 * Object.keys helper and an interned array-map helper, so it moves every
 * whole-program counter a cached library fragment would have baked.
 *
 * The two entries sit in ONE directory so the module graph either entry
 * resolves is the same tree on disk (the entry path selects the dependency
 * tree; two copies would be two trees).
 */
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

const [srcRoot, dstRoot] = process.argv.slice(2)
const TS_PERT = [
  '',
  'interface SepcompProbeShape { zeta: string; alpha: number }',
  'const __sepcompProbe: SepcompProbeShape = { zeta: "z", alpha: 1 };',
  'const __sepcompBump = (n: number): number => n + 1;',
  'console.log(Object.keys(__sepcompProbe).join("-"), __sepcompBump(1), [2, 3].map(__sepcompBump).join("+"));',
  '',
].join('\n')
const JS_PERT = [
  '',
  'const __sepcompProbe = { zeta: "z", alpha: 1 };',
  'const __sepcompBump = (n) => n + 1;',
  'console.log(Object.keys(__sepcompProbe).join("-"), __sepcompBump(1), [2, 3].map(__sepcompBump).join("+"));',
  '',
].join('\n')

const ENTRIES = ['main.ts', 'main.mjs', 'main.cjs', 'main.js', 'index.ts', 'index.js']
mkdirSync(dstRoot, { recursive: true })
const picked = []
for (const name of readdirSync(srcRoot)) {
  const dir = join(srcRoot, name)
  if (!statSync(dir).isDirectory()) continue
  const entry = ENTRIES.find((e) => existsSync(join(dir, e)))
  if (!entry) continue
  const srcs = readdirSync(dir).filter((f) => /\.(ts|js|mjs|cjs)$/.test(f))
  const dirs = readdirSync(dir).filter((f) => statSync(join(dir, f)).isDirectory())
  if (srcs.length < 2 && dirs.length === 0) continue
  const out = join(dstRoot, name)
  cpSync(dir, out, { recursive: true })
  const ext = entry.slice(entry.lastIndexOf('.'))
  const pert = ext === '.ts' ? TS_PERT : JS_PERT
  const pertName = `main_pert${ext}`
  // The perturbed entry keeps the base entry's bytes verbatim and appends;
  // every location in the shared prefix therefore keeps its offset.
  const base = readFileSync(join(out, entry))
  writeFileSync(join(out, pertName), Buffer.concat([base, Buffer.from(pert, 'utf8')]))
  picked.push(`${name}\t${entry}\t${pertName}`)
}
writeFileSync(join(dstRoot, 'PROGRAMS.tsv'), picked.join('\n') + '\n')
console.log(`prepared ${picked.length} multi-module programs`)
