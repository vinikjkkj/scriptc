// Cell-by-cell before/after, the way the bar asks for it:
//   N WRONG->MATCH, M MATCH->WRONG   (M must be zero)
// plus every other transition, named, because a MATCH that became a TRAP is a
// coverage loss and must not hide inside "no wrong answers".
//
// argv: <before.json> <after.json> [...pairs]
import { readFileSync } from 'node:fs'

const args = process.argv.slice(2)
const trans = new Map()
const detail = []
let cells = 0
for (let i = 0; i < args.length; i += 2) {
  const a = JSON.parse(readFileSync(args[i], 'utf8'))
  const b = JSON.parse(readFileSync(args[i + 1], 'utf8'))
  const bb = new Map(b.rows.map((r) => [r.id, r]))
  for (const r of a.rows) {
    const s = bb.get(r.id)
    cells++
    if (!s) { detail.push('MISSING-AFTER ' + r.id); continue }
    const k = r.verdict + ' -> ' + s.verdict
    trans.set(k, (trans.get(k) ?? 0) + 1)
    if (r.verdict !== s.verdict) {
      detail.push(k + '  ' + r.id + '  before(got=' + r.got + ') after(got=' + s.got + ') node=' + r.node)
    }
  }
  for (const r of b.rows) if (!a.rows.some((x) => x.id === r.id)) detail.push('MISSING-BEFORE ' + r.id)
}
console.log('cells compared: ' + cells)
for (const [k, v] of [...trans].sort()) console.log(String(v).padStart(6) + '  ' + k)
console.log('--- every changed cell ---')
for (const d of detail) console.log('  ' + d)
