// `new X.constructor(consts)` / `X.constructor(consts)` where X.constructor may be the Function constructor (protobufjs' Reader does
// `new this.buf.constructor(0)`): when it is, the text is a build-time constant, so the function it denotes is compiled natively; when it is
// not, the original construct runs. The program needs no embedded engine, and every answer, including the staged function's length, name and
// source text, is Node's.
function sample(a, b) { return a + b }
const holder = {}
holder.fn = sample
holder.arr = JSON.parse('[1, 2, 3]')
class Box { constructor(n) { this.n = n === undefined ? 7 : n } }
holder.inst = new Box(1)
holder.obj = JSON.parse('{"k": 1}')
const g = new holder.fn.constructor(0)
console.log(typeof g, g.length, g.name, String(g), g(), g() === undefined)
const h = holder.fn.constructor('a', 'b', 'return a * b')
console.log(h(6, 7), h.length, h.name, String(h))
const e = new holder.fn.constructor()
console.log(typeof e, e.length, String(e), e())
console.log(new holder.arr.constructor(3).length, new holder.inst.constructor(4).n, Object.keys(new holder.obj.constructor()).length)
console.log(holder.inst.constructor === Box)
function clone(x) { return new x.constructor(0) }
console.log(clone(holder.arr).length, clone(holder.inst).n, typeof clone(holder.fn))
const p = Object.getPrototypeOf(sample)
console.log(new p.constructor('return 9')(), new p.constructor('x', 'return x')(4))
