// The descriptor SHAPES the run-time table holds, and what util.inspect
// prints for each: a data property renders its VALUE, and an accessor
// renders `[Getter]` / `[Setter]` / `[Getter/Setter]` and is NOT called.
//
// WHY THIS PROGRAM EXISTS: a getter that runs at print time is a side
// effect Node never performs, and "invoked once and cached" is the other
// half of the same mistake. The call counter below is the assertion: it
// stays 0 across two prints.
class C {
  a: number
  constructor() { this.a = 1 }
}

const g = process.argv.length > 99 ? 'zz' : 'g'
const s = process.argv.length > 99 ? 'zz' : 's'
const gs = process.argv.length > 99 ? 'zz' : 'gs'
const d = process.argv.length > 99 ? 'zz' : 'd'

const c = new C()
let calls = 0
Object.defineProperty(c, g, { get: () => { calls += 1; return calls }, enumerable: true, configurable: true })
Object.defineProperty(c, s, { set: (v: number) => { calls += 1000 }, enumerable: true, configurable: true })
Object.defineProperty(c, gs, { get: () => 1, set: (v: number) => { }, enumerable: true, configurable: true })
Object.defineProperty(c, d, { value: 'plain', enumerable: true, writable: true, configurable: true })
console.log(c)
console.log(c)
console.log('calls ' + String(calls))

// Nested: an instance carrying a table, inside a record, past the default
// depth budget.
const wrap = { l1: { l2: { l3: c } } }
console.log(wrap)

// And in an array, beside a sibling that has no table entries at all.
const xs = [new C(), c]
console.log(xs)
