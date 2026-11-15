// A dyn that is checked into a number and boxed again keeps its node: -0, NaN, 2^53, the infinities and a fraction come out as the same values,
// through `as number` casts, a typeof narrowing and a length read.
const src: any = {}
src.nz = -0
src.nan = NaN
src.big = 2 ** 53
src.inf = Infinity
src.ninf = -Infinity
src.frac = 0.1 + 0.2
src.small = 7
src.s = 'text'
src.u = undefined
const dst: any = {}
dst.nz = src.nz as number
dst.nan = src.nan as number
dst.big = src.big as number
dst.inf = src.inf as number
dst.ninf = src.ninf as number
dst.frac = src.frac as number
dst.small = src.small as number
console.log(Object.is(dst.nz, -0), Number.isNaN(dst.nan), dst.big === 2 ** 53, dst.inf, dst.ninf, dst.frac, dst.small)
console.log(Object.is(src.nz, dst.nz), String(dst.big + 1))
function arrow(o: any) { const n = o.v; if (typeof n === 'number') { const t: any = {}; t.k = n; return t.k } return 'no' }
console.log(arrow({ v: -0 }) === 0, Object.is(arrow({ v: -0 }), -0), arrow({ v: 'x' }), arrow({ v: 5 }), Number.isNaN(arrow({ v: NaN })))
let sum = 0
const arr: any = []
for (let i = 0; i < 100; i++) arr.push(i)
for (let i = 0; i < 100; i++) { const pos = arr.length; dst['p' + i] = pos; sum += pos }
console.log(sum, dst.p99)
