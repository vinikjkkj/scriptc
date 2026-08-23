// Which RECEIVER expressions the run-time-keyed define admits: a
// module-level `const` (a global, not a local), an array element, and a
// method's own `this`.
//
// WHY THIS PROGRAM EXISTS: both class defineProperty lowerings used to
// bind the receiver to its OWN local, which declined every receiver that
// is not one -- so the whole spelling refused at module level and compiled
// inside a function. Each receiver below is one of those.
//
// The class is a LEAF on purpose. A class with a subclass keeps the fence,
// and it has to: the define's collision check and `in` read ONE closed
// member set, and that set is only exact when the receiver's static class
// IS its runtime class. A `Base`-typed binding holding a `Derived` would
// need the derived members too, and answering without them is the silent
// wrong answer the whole table is built to avoid.
class B {
  a: number
  constructor() { this.a = 1 }
}
class D extends B {
  b: number
  constructor() { super(); this.b = 2 }
  expose(name: string, v: string): void {
    Object.defineProperty(this, name, { get: () => v, enumerable: true, configurable: false })
  }
}

const k = process.argv.length > 99 ? 'zz' : 'p'

// a module-level const receiver
const g = new D()
Object.defineProperty(g, k, { get: () => 'global', enumerable: true, configurable: true })
console.log(g)

// an element receiver
const xs = [new D(), new D()]
Object.defineProperty(xs[0], k, { get: () => 'elem', enumerable: true, configurable: true })
console.log(xs)

// `this` inside a method -- zapo's shape is a parameter, this is its
// nearest sibling
const t = new D()
t.expose(k, 'method')
console.log(String(k in t))
console.log(t)
