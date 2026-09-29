/* CANDIDATES for the consultation blind spot.
 *
 * A consultation whose NEGATIVE or ABSENT answer changes behaviour leaves no
 * trace in the product, by construction: the product records what HAPPENED,
 * and this class is defined by nothing having happened. It is therefore the
 * one thing a lowering fragment cannot derive from the IR, and the one thing
 * that needs enumerating — which is the failure mode that goes silent.
 *
 * NOT COMPLETE, AND CANNOT BE. It finds module-level Sets and Maps in the
 * frontend and reports where a NEGATIVE test on one gates control flow,
 * which is the shape overflowShapeKeys has. Candidates to read, not a list
 * to trust.
 *
 * NO REGEX, DELIBERATELY. The first version built its matcher as a regex
 * inside a template literal inside a bash heredoc, and the backslashes were
 * eaten crossing the parse layers — the fifth time that exact route
 * degraded silently in this block in one day. Plain string matching needs no
 * escapes, so there is nothing for a parse layer to eat.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const root = process.argv[2]
if (!root) { console.error('usage: node blindspot-scan.mjs <dir>'); process.exit(2) }

const files = []
const walk = (d) => {
  for (const e of readdirSync(d)) {
    const p = join(d, e)
    if (statSync(p).isDirectory()) walk(p)
    else if (p.endsWith('.ts')) files.push(p)
  }
}
walk(root)

// Module-level mutable registries: the things a lowering consults whose
// answer is not a property of the code being lowered.
const registries = new Map()
for (const f of files) {
  for (const line of readFileSync(f, 'utf8').split(/\r?\n/)) {
    // COLUMN 0 ONLY. A function-local Set is not the hazard: its contents
    // are derived from the code being lowered, so the product shows them.
    // The blind spot is a registry that OUTLIVES one module's lowering and
    // whose answer is not a property of that module. Matching the trimmed
    // line counted every local and reported 222 registries.
    if (line !== line.trimStart()) continue
    const t = line
    for (const prefix of ['const ', 'export const ']) {
      if (!t.startsWith(prefix)) continue
      const rest = t.slice(prefix.length)
      const eq = rest.indexOf(' = new ')
      if (eq < 0) continue
      const name = rest.slice(0, eq)
      const ctor = rest.slice(eq + 7)
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) continue
      if (ctor.startsWith('Set<') || ctor.startsWith('Map<')) registries.set(name, f)
    }
  }
}

const hits = []
for (const f of files) {
  const lines = readFileSync(f, 'utf8').split(/\r?\n/)
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    for (const [name, decl] of registries) {
      // ANY consultation, not a "negative test".
      //
      // The first cut looked for !X.has( and X.get() === undefined, and
      // found ZERO — while overflowShapeKeys, the one instance known to
      // exist, sat right there. It is spelled as a positive early return
      // (`if (denied.has(k)) return indexValue;`) and a ternary
      // (`return granted.has(k) ? DYN : indexValue`). The negative answer
      // was never a syntactic form; it is the OTHER branch of whatever
      // form the author chose, and there are unboundedly many.
      //
      // So the candidate set is every consultation of a registry that
      // outlives one module's lowering. The negative answer is implicit in
      // all of them, and implicit is exactly what leaves no trace.
      if (!line.includes(name + '.has(') && !line.includes(name + '.get(')) continue
      if (line.trimStart().startsWith('*')) continue // a comment, not a call
      hits.push({
        file: f.replace(root, ''), line: i + 1, registry: name,
        declaredIn: decl.replace(root, ''),
        text: line.trim().slice(0, 100),
      })
    }
  }
}

console.log('module-level registries in the frontend: ' + registries.size)
console.log('negative consultations that gate control flow: ' + hits.length)
console.log('')
for (const h of hits) {
  console.log('  ' + h.registry.padEnd(28) + h.file + ':' + h.line)
  console.log('      ' + h.text)
}
console.log('')
console.log('Each is a place where NOT finding something can change what is lowered.')
console.log('If the fragment does not witness the negative answer, a later build')
console.log('whose answer differs replays a module that is no longer correct.')

// POSITIVE CONTROL. overflowShapeKeys is the one instance this block has
// already found and fixed, so a scan that does not surface it is not
// calibrated and its count means nothing. An earlier cut reported ZERO with
// this very registry in range.
const KNOWN = 'overflowShapeKeys'
const found = hits.some((h) => h.registry.startsWith(KNOWN))
console.log('')
console.log(found
  ? 'CONTROL ok: the known instance (' + KNOWN + ') is in the candidate set.'
  : 'CONTROL FAILED: ' + KNOWN + ' is a known instance and is NOT in the set. The count above is void.')
process.exit(found ? 0 : 1)
