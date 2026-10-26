// Namespace construction of a function constructor whose prototype methods use
// `this` state: a chained method call, separate instances keep separate state, and
// the method result of one call feeds the next.
const lib = require("./lib/index.cjs")
const counters = require("./lib/counter.cjs")

const a = new counters.Counter(5)
console.log(a.add(2).add(3).describe())
const b = new counters.Counter()
console.log(b.describe(), b.add(1).n, a.n)
console.log(a.reset(), a.n, a.describe())
console.log(lib.makeTotal([1, 2, 3, 4]).describe())
const viaLib = new lib.Counter(10)
console.log(viaLib.add(-4).n, viaLib.describe())
console.log(new lib.Counter(1).add(1).add(1).reset(), a.log.length)
