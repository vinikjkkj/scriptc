// The attribute half of the run-time property table: `enumerable`,
// `configurable` and the redefinition rule, each measured against Node.
//
// WHY THIS PROGRAM EXISTS: a per-instance property table's silent failure
// modes are all attribute failures -- a non-enumerable key that shows up in
// a print, a `configurable: false` property that a second define quietly
// replaces, an omitted flag that defaults instead of being inherited. Each
// one is a wrong answer nothing else in the suite would catch.
class C {
  a: number
  constructor() { this.a = 1 }
}

const k = process.argv.length > 99 ? 'zz' : 'p'
const h = process.argv.length > 99 ? 'zz' : 'q'

// A NON-enumerable accessor: `in` sees it, util.inspect does not.
const c1 = new C()
Object.defineProperty(c1, h, { get: () => 1, enumerable: false, configurable: true })
console.log('hidden-in ' + String(h in c1))
console.log(c1)

// `configurable: false` -- a second define is a TypeError, and the FIRST
// getter survives it.
const c2 = new C()
Object.defineProperty(c2, k, { get: () => 1, enumerable: true, configurable: false })
try {
  Object.defineProperty(c2, k, { get: () => 2, enumerable: true, configurable: false })
  console.log('sealed: no throw')
} catch (e) {
  console.log('sealed: ' + (e as Error).message)
}
console.log(c2)

// `configurable: true` -- the redefinition lands, and an OMITTED flag keeps
// the CURRENT value rather than defaulting to false. Here `enumerable` is
// spelled false, so the key leaves the print.
const c3 = new C()
Object.defineProperty(c3, k, { get: () => 1, enumerable: true, configurable: true })
Object.defineProperty(c3, k, { get: () => 2, enumerable: false, configurable: true })
console.log('redefined-in ' + String(k in c3))
console.log(c3)

// A descriptor that is BOTH an accessor and a data property is Node's
// TypeError, and it fires before anything is stored.
const c4 = new C()
try {
  Object.defineProperty(c4, k, { get: () => 1, value: 2 })
  console.log('both: no throw')
} catch (e) {
  console.log('both: ' + (e as Error).message)
}
console.log('both-in ' + String(k in c4))
