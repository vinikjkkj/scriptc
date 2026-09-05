// A method whose PARAMETER and whose RETURN are the `any`-indexed type,
// overridden and reached through a base-typed reference -- the vtable slot
// is typed from the declarer's thunk, so the store's representation has to
// agree on both sides of the dispatch. mongodb's operations tree is shaped
// exactly this way: `execute(...): Promise<Document>` declared on an
// abstract base and overridden all the way down.
interface Doc { [key: string]: any }

abstract class Op {
  abstract run(d: Doc): Doc
  label(d: Doc): string { return 'op:' + String(d.a) }
}
class Inc extends Op {
  run(d: Doc): Doc { return { a: (d.a as number) + 1, from: 'inc' } }
}
class Dec extends Op {
  run(d: Doc): Doc { return { a: (d.a as number) - 1, from: 'dec' } }
  label(d: Doc): string { return 'dec:' + String(d.a) }
}

function drive(o: Op, d: Doc): string {
  const out = o.run(d)
  return o.label(out) + '/' + String(out.a) + '/' + String(out.from)
}

const ops: Op[] = [new Inc(), new Dec()]
for (const o of ops) console.log(drive(o, { a: 10 }))

// through a base-typed slot, twice, so the dispatch is not devirtualized
let cur: Op = new Inc()
console.log(cur.run({ a: 1 }).a)
cur = new Dec()
console.log(cur.run({ a: 1 }).a)
console.log(cur.label({ a: 5 }))

// a generic function over the same parameter type
function apply<T extends Op>(o: T, d: Doc): Doc { return o.run(d) }
console.log(String(apply(new Inc(), { a: 41 }).a))
