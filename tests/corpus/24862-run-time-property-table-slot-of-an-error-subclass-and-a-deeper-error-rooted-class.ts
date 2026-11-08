// Instances of a user subclass of Error, of a subclass of THAT, and of a plain class that carries a run-time property table (the
// program stores a symbol-keyed property through an untyped receiver), held in untyped slots and read back by a literal key and by a
// computed key: declared members, the inherited message, a symbol-keyed write and a miss.
//
// An Error-rooted class's `%props` cell is the runtime Error's own prefix cell, so the descriptor of a boxed Error subclass names no
// struct of its own to take a property-table offset from. A descriptor that was built as `offsetof(<runtime Error>, %props)` made the C
// compiler refuse the whole program; this row fails to BUILD on that code.
const sym = Symbol('tag')
const k = process.argv.length > 99 ? 'zz' : 'code'
class AppError extends Error { code = 'E_APP'; tag = 'app' }
class DeepError extends AppError { depth = 2 }
class PlainError extends Error { note = 'plain' }
class Plain { id = 7; tag = 'plain' }
const a = new AppError('first')
const d = new DeepError('second')
const p = new PlainError('third')
const q = new Plain()
function setTag(o: any, v: number): void { o[sym] = v }
setTag(q, 3)
const slots: any[] = [a, d, p, q]
function lit(o: any): string { return String(o.code) + ',' + String(o.tag) + ',' + String(o.id) + ',' + String(o.message) + ',' + String(o.nothing) }
function comp(o: any, key: string): string { return String(o[key]) }
const out: string[] = []
for (let r = 0; r < 2; r++) {
  for (const o of slots) out.push(lit(o) + '|' + comp(o, k) + '|' + comp(o, 'tag') + '|' + comp(o, 'depth') + '|' + String(o[sym]))
}
console.log(out.join('\n'))
