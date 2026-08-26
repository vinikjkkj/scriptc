// The spread SOURCE mutates while the argument list is being evaluated.
// JS reads the array's elements at the moment the spread is walked, so a
// later argument's side effect must NOT be visible to an earlier spread,
// and an earlier argument's side effect MUST be visible to a later one.
function fmt(args: unknown[]): string {
  let line = "n=" + String(args.length) + " ["
  for (let i = 0; i < args.length; i++) {
    if (i > 0) line = line + ","
    line = line + String(args[i])
  }
  return line + "]"
}
function shape(a: unknown[]): string {
  let line = "["
  for (let i = 0; i < a.length; i++) {
    if (i > 0) line = line + ","
    line = line + String(a[i])
  }
  return line + "]"
}
function take(...args: unknown[]): void {
  console.log("  -> " + fmt(args))
}
const xs: unknown[] = [1, 2]

console.log("A: a later argument pushes onto xs")
take(...xs, (() => { xs.push(99); return "sideA" })())
console.log("   xs is now " + shape(xs))

const ys: unknown[] = [1, 2]
console.log("B: an earlier argument pushes onto ys, then ys spreads")
take((() => { ys.push(98); return "sideB" })(), ...ys)
console.log("   ys is now " + shape(ys))

const zs: unknown[] = [1, 2]
console.log("C: between two spreads of the SAME array")
take(...zs, (() => { zs.push(97); return "mid" })(), ...zs)
console.log("   zs is now " + shape(zs))

const ws: unknown[] = [1, 2, 3]
console.log("D: an earlier argument POPS from the array a later spread walks")
take((() => { ws.pop(); return "cut" })(), ...ws)
console.log("   ws is now " + shape(ws))
