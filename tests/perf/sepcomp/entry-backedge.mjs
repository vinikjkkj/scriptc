/* Programs where a NON-ENTRY module imports the entry by name.
 *
 * The sweep puts base and perturbed entries side by side in one directory so
 * both resolve the same module tree. That is exact UNLESS some module in the
 * tree imports the entry by its file name: building `main_pert.ts` then pulls
 * `main.ts` in as an extra module, so the two arms are not one program under
 * an entry edit — they are two different programs. Such rows are excluded
 * from the neutrality claim, by this mechanical test rather than by eye.
 *
 * No regex: every quoted specifier is extracted literally and its BASENAME
 * compared to the entry's, because a pattern carrying backslash escapes
 * through a second parse layer is exactly how a silent zero gets produced.
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { basename, join } from 'node:path'
const root = process.argv[2]
const rows = readFileSync(join(root, 'PROGRAMS.tsv'), 'utf8').trim().split('\n').map((l) => l.split('\t'))

/** Every single- or double-quoted string in the text, contents only. */
function quoted(text) {
  const out = []
  for (const q of ['"', "'"]) {
    let i = 0
    for (;;) {
      const a = text.indexOf(q, i); if (a < 0) break
      const b = text.indexOf(q, a + 1); if (b < 0) break
      out.push(text.slice(a + 1, b)); i = b + 1
    }
  }
  return out
}
const stripExt = (s) => (s.includes('.') ? s.slice(0, s.lastIndexOf('.')) : s)

const out = []
for (const [name, entry] of rows) {
  const dir = join(root, name)
  const stem = stripExt(entry)
  const hits = []
  const walk = (d) => {
    for (const f of readdirSync(d)) {
      const p = join(d, f)
      if (statSync(p).isDirectory()) { walk(p); continue }
      if (!(f.endsWith('.ts') || f.endsWith('.js') || f.endsWith('.mjs') || f.endsWith('.cjs'))) continue
      if (p === join(dir, entry) || f.startsWith('main_pert')) continue
      for (const s of quoted(readFileSync(p, 'utf8'))) {
        if (!s.startsWith('.') && !s.startsWith('/')) continue
        if (stripExt(basename(s)) === stem) { hits.push(`${p.slice(dir.length + 1)} -> ${s}`); break }
      }
    }
  }
  if (existsSync(dir)) walk(dir)
  if (hits.length) out.push(`${name}\t${hits.join(', ')}`)
}
for (const r of out) console.log(r)
console.log(`\n${out.length} of ${rows.length} program(s) have a module importing the entry by name`)
