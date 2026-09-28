/* The renumbering question, asked without trusting names.
 *
 * classify.mjs matched base and perturbed functions by NAME, and the names
 * are exactly what a counter shift moves: the entry's added lambda takes
 * `%fn8`, the library's `%fn8` becomes `%fn9`, and a by-name comparison then
 * reports a library function as "semantically changed" when the compiler did
 * nothing of the kind. So ask it name-independently.
 *
 * For each arm: take the functions whose source is NOT the entry, strip
 * source locations, and canonicalise every POSITIONAL id to its family alone
 * (`%fn12` -> `%fn#`, `r17` -> `r#`, `%union.retag.4` -> `%union.retag.#`,
 * `%C.m%3` -> `%C.m%#`). Compare the resulting MULTISETS.
 *
 * Equal multisets mean: every non-entry function in the base build has a
 * perturbed counterpart identical up to the positional ids an assembler
 * re-mints anyway. A surviving difference is something the design cannot
 * re-derive, and is printed in full.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const outRoot = process.argv[2]
// Programs excluded by entrybackedge.mjs: a module imports the entry by name,
// so the perturbed entry makes the base entry an EXTRA module and the two arms
// are two different programs, not one program under an entry edit.
const EXCLUDE = new Set((process.argv[3] ?? '').split(',').filter(Boolean))
const irOf = (d) => {
  if (!existsSync(d)) return null
  const f = readdirSync(d).find((x) => x.endsWith('.ir.json'))
  return f ? JSON.parse(readFileSync(join(d, f), 'utf8')) : null
}
const fileOf = (fn) => {
  let found = null
  const walk = (n) => {
    if (found !== null || n === null || typeof n !== 'object') return
    if (Array.isArray(n)) { for (const x of n) walk(x); return }
    if (typeof n.file === 'string' && typeof n.start === 'number') { found = n.file; return }
    for (const v of Object.values(n)) walk(v)
  }
  walk(fn); return found
}
const stripLocs = (n) => {
  if (n === null || typeof n !== 'object') return n
  if (Array.isArray(n)) return n.map(stripLocs)
  const o = {}
  for (const [k, v] of Object.entries(n)) { if (k !== 'loc') o[k] = stripLocs(v) }
  return o
}
/* Positional ids are folded to their RANK OF FIRST APPEARANCE inside this
 * one function, not to a bare '#'. Folding them all to one token would
 * accept a function that mentions one id twice against one that mentions
 * two different ids -- a forgetful match, not a renaming. Ranking keeps
 * every within-function relationship between ids while removing the offset
 * whole-program interning order gives them. Cross-FUNCTION consistency is
 * still not proved by this: an implementation has to carry ONE substitution
 * for a whole fragment, and this test does not stand in for that. */
const canon = (s) => {
  const rank = new Map()
  const counts = new Map()
  const of = (fam, tok) => {
    const k = fam + '\u0001' + tok
    let r = rank.get(k)
    if (r === undefined) { r = counts.get(fam) ?? 0; counts.set(fam, r + 1); rank.set(k, r) }
    return r
  }
  return s
    .replace(/"r\d+"/g, (m) => '"r~' + of('r', m) + '"')
    .replace(/"u\d+"/g, (m) => '"u~' + of('u', m) + '"')
    .replace(/%fn\d+\b/g, (m) => '%fn~' + of('fn', m))
    .replace(/%([A-Za-z][A-Za-z0-9.]*)\.\d+\b/g, (m, fam) => '%' + fam + '.~' + of(fam, m))
    .replace(/%(\d+)\b/g, (m) => '%~' + of('inst', m))
}

let progs = 0, equal = 0
const bad = []
let totalFns = 0
for (const name of readdirSync(outRoot).sort()) {
  if (EXCLUDE.has(name)) continue
  const B = irOf(join(outRoot, name, 'base')), P = irOf(join(outRoot, name, 'pert'))
  if (!B || !P) continue
  progs++
  const pick = (M) => M.functions
    .filter((f) => { const fl = fileOf(f); return fl !== null && fl !== B.sourceFile && fl !== P.sourceFile })
    .map((f) => canon(JSON.stringify(stripLocs(f))))
  const b = pick(B).sort(), p = pick(P).sort()
  totalFns += b.length
  // Multiset containment both ways is set equality on sorted arrays.
  if (b.length === p.length && b.every((x, i) => x === p[i])) { equal++; continue }
  const pc = new Map(); for (const x of p) pc.set(x, (pc.get(x) ?? 0) + 1)
  const missing = []
  for (const x of b) { const c = pc.get(x) ?? 0; if (c === 0) missing.push(x); else pc.set(x, c - 1) }
  bad.push({ name, baseN: b.length, pertN: p.length, missing })
}
console.log(`programs compared                 : ${progs}`)
console.log(`non-entry functions (base arms)   : ${totalFns}`)
console.log(`programs whose non-entry multiset`)
console.log(`  is identical up to positional ids: ${equal}`)
console.log(`  differs                          : ${bad.length}`)
for (const r of bad) {
  console.log(`\n--- ${r.name}  base=${r.baseN} pert=${r.pertN}  unmatched=${r.missing.length}`)
  for (const m of r.missing.slice(0, 3)) console.log('    ' + m.slice(0, 900))
}
