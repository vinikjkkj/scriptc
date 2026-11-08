// Instances of user subclasses of Error carry an expando bag (the runtime Error's own cell, named %props in the class definition), and
// properties written through an untyped receiver land there. A keyed read through an untyped slot must answer from that bag exactly as
// Node does, by a literal key and by a computed key, for a name the class declares, a name only the bag holds, an inherited message and
// a miss. Reading the bag's cell as if it were a class property table (a cell an Error-rooted class has no table offset for) answers
// from the wrong structure.
const k = process.argv.length > 99 ? 'zz' : 'extra'
class AppError extends Error { code = 'E_APP' }
class DeepError extends AppError { depth = 2 }
function put(o: any, key: string, v: number): void { o[key] = v }
const a = new AppError('first')
const d = new DeepError('second')
put(a, 'extra', 11)
put(a, 'other', 12)
put(d, 'extra', 21)
const slots: any[] = [a, d]
function lit(o: any): string { return String(o.code) + ',' + String(o.extra) + ',' + String(o.other) + ',' + String(o.message) + ',' + String(o.nothing) }
function comp(o: any, key: string): string { return String(o[key]) }
const out: string[] = []
for (let r = 0; r < 2; r++) {
  for (const o of slots) out.push(lit(o) + '|' + comp(o, k) + '|' + comp(o, 'other') + '|' + comp(o, 'depth'))
}
console.log(out.join('\n'))
