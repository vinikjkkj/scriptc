// Math members as first-class values: passed as callbacks, bound to a name, destructured off Math, called through an alias of Math, and
// hypot (declared variadic) taken as a value and called with different argument counts. Every call must equal Node's bits.
const roots = [1, 4, 9, 2].map(Math.sqrt)
console.log(roots.join(','))
const f = Math.sin
const g = Math.atan2
console.log(f(1), g(1, 2))
const { cos, exp: e, log10, PI } = Math
console.log(cos(1), e(1), log10(1000), PI)
const m = Math
console.log(m.sqrt(2), m.tanh(0.5), m.E, m.hypot(3, 4), m.hypot(1, 2, 3))
const h = Math.hypot
console.log(h(), h(5), h(3, 4), h(1, 2, 3, 4), h(NaN, Infinity), h(0, -0))
const fns = [Math.cbrt, Math.expm1, Math.log1p, Math.asinh, Math.sign, Math.abs, Math.trunc]
console.log(fns.map((fn) => fn(2.5)).join(' '))
let acc = 0
for (const v of [0.5, 1, 1.5, 2]) acc += [Math.sinh, Math.cosh, Math.acos].reduce((s, fn) => s + fn(v / 4), 0)
console.log(acc)
