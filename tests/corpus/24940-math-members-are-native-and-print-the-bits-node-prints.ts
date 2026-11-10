// Every Math member that lowers natively, over a deterministic sample of its domain and its edge values (+-0, +-Infinity, NaN, the
// smallest subnormal, the largest double, huge arguments for sin/cos/tan), compared with Node bit for bit: each function prints the count of
// its NaN answers, a checksum over the shortest-round-trip text of EVERY answer (so a single last-bit difference anywhere in the sample
// changes the line), and its first answers in full. The platform libm answers differently from V8's fdlibm port in the last bit for most
// of the transcendental members, so this row fails if any of them is a platform libm call.
//
// A call whose argument is a literal and the same call on a value read at run time must print the same bits (the compiler does not fold
// them, but a C compiler folding a libm builtin at its own precision would split them): the last block prints SAME for each.
let seed = 0x2545f491
function next(): number {
  seed ^= seed << 13
  seed ^= seed >>> 17
  seed ^= seed << 5
  return seed >>> 0
}
function sample(): number {
  const a = next()
  const b = next()
  const sign = (a & 1) === 0 ? 1 : -1
  const mant = (b / 4294967296) + 0.5
  const exp = ((a >>> 1) % 70) - 30
  return sign * mant * Math.pow(2, exp)
}
const edges: number[] = [0, -0, 1, -1, 0.5, -0.5, 2, -2, 10, 1e-10, 1e-300, 5e-324, 2.2250738585072014e-308, 1e300, 1.7976931348623157e308, Infinity, -Infinity, NaN,
  Math.PI, Math.PI / 2, Math.PI / 4, 1e5, 1e10, 1e15, 1e22, 710, -745, 709.78, 0.1, 0.2, 0.3, 1.5, 2.5, -2.5, 3, 100, 1000, 4294967296, 2147483648, 0.99999999999999989]
const xs: number[] = edges.slice()
for (let i = 0; i < 3000; i++) xs.push(sample())
function fnv(h: number, s: string): number {
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619)
  return h >>> 0
}
function report(name: string, f: (x: number) => number, map: (x: number) => number): void {
  let h = 2166136261
  let nan = 0
  const first: string[] = []
  for (let i = 0; i < xs.length; i++) {
    const r = f(map(xs[i]!))
    if (r !== r) nan++
    h = fnv(h, Object.is(r, -0) ? '-0' : String(r))
    if (i < 3) first.push(Object.is(r, -0) ? '-0' : String(r))
  }
  console.log(name + ' nan=' + nan + ' hash=' + h + ' first=' + first.join(','))
}
const id = (x: number): number => x
const unit = (x: number): number => x / (1 + Math.abs(x))
const pos = (x: number): number => Math.abs(x)
const ge1 = (x: number): number => 1 + Math.abs(x)
report('sqrt', (x) => Math.sqrt(x), pos)
report('sign', (x) => Math.sign(x), id)
report('sin', (x) => Math.sin(x), id)
report('cos', (x) => Math.cos(x), id)
report('tan', (x) => Math.tan(x), id)
report('asin', (x) => Math.asin(x), unit)
report('acos', (x) => Math.acos(x), unit)
report('atan', (x) => Math.atan(x), id)
report('exp', (x) => Math.exp(x), id)
report('expm1', (x) => Math.expm1(x), id)
report('log', (x) => Math.log(x), pos)
report('log1p', (x) => Math.log1p(x), id)
report('log2', (x) => Math.log2(x), pos)
report('log10', (x) => Math.log10(x), pos)
report('sinh', (x) => Math.sinh(x), id)
report('cosh', (x) => Math.cosh(x), id)
report('tanh', (x) => Math.tanh(x), id)
report('asinh', (x) => Math.asinh(x), id)
report('acosh', (x) => Math.acosh(x), ge1)
report('atanh', (x) => Math.atanh(x), unit)
report('cbrt', (x) => Math.cbrt(x), id)
report('abs', (x) => Math.abs(x), id)
report('floor', (x) => Math.floor(x), id)
report('ceil', (x) => Math.ceil(x), id)
report('trunc', (x) => Math.trunc(x), id)
report('round', (x) => Math.round(x), id)
report('fround', (x) => Math.fround(x), id)
report('clz32', (x) => Math.clz32(x), id)
// Two-argument members: each sample against its neighbour in the list.
function report2(name: string, f: (a: number, b: number) => number): void {
  let h = 2166136261
  let nan = 0
  const first: string[] = []
  for (let i = 0; i + 1 < xs.length; i++) {
    const r = f(xs[i]!, xs[i + 1]!)
    if (r !== r) nan++
    h = fnv(h, Object.is(r, -0) ? '-0' : String(r))
    if (i < 3) first.push(Object.is(r, -0) ? '-0' : String(r))
  }
  console.log(name + ' nan=' + nan + ' hash=' + h + ' first=' + first.join(','))
}
report2('atan2', (a, b) => Math.atan2(a, b))
report2('hypot', (a, b) => Math.hypot(a, b))
report2('pow', (a, b) => Math.pow(a, b))
report2('**', (a, b) => a ** b)
report2('imul', (a, b) => Math.imul(a, b))
report2('min', (a, b) => Math.min(a, b))
report2('max', (a, b) => Math.max(a, b))
function report3(name: string, f: (a: number, b: number, c: number) => number): void {
  let h = 2166136261
  const first: string[] = []
  for (let i = 0; i + 2 < xs.length; i++) {
    const r = f(xs[i]!, xs[i + 1]!, xs[i + 2]!)
    h = fnv(h, Object.is(r, -0) ? '-0' : String(r))
    if (i < 3) first.push(String(r))
  }
  console.log(name + ' hash=' + h + ' first=' + first.join(','))
}
report3('hypot3', (a, b, c) => Math.hypot(a, b, c))
// pow over the shapes its platform implementations disagree on: non-integer and integer exponents, huge and tiny and subnormal bases, a negative
// base with an integer exponent (the sign by parity), the exponents 0.5 and 2 that V8 answers exactly, and the spec's NaN and +-1 ** Infinity rules.
function reportPowGrid(): void {
  const bases: number[] = [0, -0, 1, -1, 2, -2, 0.5, -0.5, 1e-300, 5e-324, -5e-324, 1e300, -1e300, 1.0000000000000002, 0.9999999999999999, 3, 7.5, -7.5, 10, 1e-10, 123456.789, -123456.789, Infinity, -Infinity, NaN]
  for (let i = 0; i < 400; i++) bases.push(sample())
  const exps: number[] = [0, -0, 0.5, -0.5, 1, -1, 2, -2, 3, -3, 4, 5, 10, -10, 100, -100, 1.5, -1.5, 2.5, 0.1, 0.3333333333333333, 1e-5, 1e5, 1e10, -1e10, 1024, 1075, -1075, 0.999999, Infinity, -Infinity, NaN, 308, -308]
  let h = 2166136261
  let nan = 0
  for (let i = 0; i < bases.length; i++) {
    for (let j = 0; j < exps.length; j++) {
      const r = Math.pow(bases[i]!, exps[j]!)
      if (r !== r) nan++
      h = fnv(h, Object.is(r, -0) ? '-0' : String(r))
    }
  }
  console.log('powgrid nan=' + nan + ' hash=' + h + ' n=' + bases.length * exps.length)
  let g = 2166136261
  for (let i = 0; i < bases.length; i++) {
    const x = bases[i]!
    const r = x ** 2 + x ** 0.5 + x ** -1 + x ** 3
    g = fnv(g, Object.is(r, -0) ? '-0' : String(r))
  }
  console.log('powops hash=' + g)
}
reportPowGrid()
// A literal call and the same call on a run-time value.
const rt = [0.5, 1, 10, 100, 0.1][process.argv.length > 99 ? 4 : 0]!
const lit: number[] = [Math.sin(0.5), Math.cos(0.5), Math.tan(0.5), Math.exp(0.5), Math.log(0.5), Math.log2(0.5), Math.log10(0.5), Math.cbrt(0.5), Math.atan(0.5), Math.asin(0.5), Math.sinh(0.5), Math.tanh(0.5), Math.expm1(0.5), Math.log1p(0.5), Math.pow(0.5, 0.5), Math.hypot(0.5, 0.5)]
const dyn: number[] = [Math.sin(rt), Math.cos(rt), Math.tan(rt), Math.exp(rt), Math.log(rt), Math.log2(rt), Math.log10(rt), Math.cbrt(rt), Math.atan(rt), Math.asin(rt), Math.sinh(rt), Math.tanh(rt), Math.expm1(rt), Math.log1p(rt), Math.pow(rt, rt), Math.hypot(rt, rt)]
const same: string[] = []
for (let i = 0; i < lit.length; i++) same.push(Object.is(lit[i]!, dyn[i]!) ? 'SAME' : 'DIFF')
console.log(same.join(' '))
console.log(lit.map((v) => String(v)).join(' '))
