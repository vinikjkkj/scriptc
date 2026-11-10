const k = process.argv.length > 99 ? 'zz' : 'sin'
const names = ['sqrt', 'sin', 'exp', 'hypot', 'max', 'atan2', 'pow', 'cbrt', 'floor', 'random2']
const M: any = Math
console.log((Math as any)[k](1))
for (const n of names.slice(0, 9)) console.log(n, (Math as any)[n](2, 3))
console.log(Math['sqrt'](16), Math["PI"], Math['hypot'](3, 4), (Math as any)['atan2'](1, 2))
const hy = names[3]!
const mx = names[4]!
console.log((Math as any)['hypot'](1, 2, 3), (Math as any)[hy](), (Math as any)[mx](4, 9, 2))
const bad = names[9]!
try { (Math as any)[bad](1) } catch (e) { console.log(String(e)) }
try { (Math as any)['PI'](1) } catch (e) { console.log(String(e)) }
// The "is not a function" text for every spelling of the key: Node prints V8's CallPrinter rendering of the callee, with parentheses, `as`
// and `!` already erased, a string key in the dot form, a computed key in brackets by the same rules, a call as `f(...)`, and a binary,
// comparison, logical or unary operation parenthesised.
const nm = ['a', 'b', 'c', 'd']
const q: string = 'q'
const r: string = 'r'
const o = { b: 'z', m(_x: number): string { return 'y' } }
function fn(..._rest: unknown[]): string { return 'w' }
const M2: any = Math
const spell: (() => void)[] = [
  () => M2[q](1), () => M2['lit'](1), () => M2['a-b'](1), () => M2[0](1), () => M2[1.5](1), () => M2[nm[3]!](1), () => M2[nm[3] as string](1),
  () => M2[(q)](1), () => M2[q + ''](1), () => M2[q + 1](1), () => M2[o.b](1), () => M2[fn()](1), () => M2[fn(1, 2)](1), () => M2[o.m(1)](1),
  () => M2[typeof q](1), () => M2[q && r](1), () => M2[q ?? r](1), () => M2[nm[1]! + nm[2]!](1), () => M2[fn(q)[0]!](1),
  () => M2[-nm.length](1), () => M2[nm.length % 2](1), () => M2[nm.length ** 2](1),
]
for (const s of spell) {
  try { s() } catch (e) { console.log(String(e)) }
}
