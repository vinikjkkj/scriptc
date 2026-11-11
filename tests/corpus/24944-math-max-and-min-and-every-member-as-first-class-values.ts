// Math.max and Math.min are rest-slot members, so their value is a closure over the packed argument array: taken as a value, destructured, mapped,
// bound through an alias of Math, and called with any number of arguments (none, one, many, NaN, signed zeros, Infinity) they answer what Node answers.
// A second block takes EVERY Math method as a value and calls it, so no member is a call-only special case.
const mx = Math.max
const mn = Math.min
console.log(mx(), mn(), mx(1), mn(1), mx(1, 2, 3), mn(3, 2, 1), mx(1, NaN, 3), mn(NaN), mx(-0, 0), mn(0, -0), mx(-Infinity), mn(Infinity, 5))
console.log(Object.is(mx(-0, -0), -0), Object.is(mn(0, 0), 0), Object.is(mx(-0, 0), 0), Object.is(mn(-0, 0), -0))
const { max, min: lowest, abs } = Math
console.log(max(4, 9, 2), lowest(4, 9, 2), abs(-3.5), max(), lowest())
const m = Math
console.log(m.max(1, 7), m.min(1, 7))
const viaArr: number[] = [5, 2, 8, 2]
console.log(viaArr.reduce((a, b) => Math.max(a, b)), viaArr.reduce((a, b) => mn(a, b)))
const table: Array<(...v: number[]) => number> = [Math.max, Math.min, Math.hypot]
console.log(table.map((fn) => fn(3, 4, 12)).join(' '), table.map((fn) => fn()).join(' '))
const unary: Array<(x: number) => number> = [Math.abs, Math.acos, Math.acosh, Math.asin, Math.asinh, Math.atan, Math.atanh, Math.cbrt, Math.ceil, Math.clz32,
  Math.cos, Math.cosh, Math.exp, Math.expm1, Math.floor, Math.fround, Math.log, Math.log10, Math.log1p, Math.log2, Math.round, Math.sign, Math.sin,
  Math.sinh, Math.sqrt, Math.tan, Math.tanh, Math.trunc]
for (const x of [0.5, 2.5, -1.5]) console.log(unary.map((fn) => fn(x)).join(' '))
const binary: Array<(a: number, b: number) => number> = [Math.atan2, Math.imul, Math.pow]
console.log(binary.map((fn) => fn(7, 3)).join(' '), binary.map((fn) => fn(-2, 0.5)).join(' '))
console.log(typeof Math.random, Math.random() < 1)
