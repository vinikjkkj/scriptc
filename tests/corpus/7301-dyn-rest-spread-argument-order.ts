// ARGUMENT ORDER and EVALUATION ORDER. Every argument expression logs
// when it is evaluated, so the transcript proves each is evaluated
// exactly once and in source order relative to the spreads around it.
function fmt(args: unknown[]): string {
  let line = "n=" + String(args.length) + " ["
  for (let i = 0; i < args.length; i++) {
    if (i > 0) line = line + ","
    line = line + String(args[i])
  }
  return line + "]"
}
function take(...args: unknown[]): void {
  console.log("  -> " + fmt(args))
}
let n = 0
function ev(tag: string, v: unknown): unknown {
  n = n + 1
  console.log("eval#" + String(n) + " " + tag)
  return v
}
function evArr(tag: string, v: unknown[]): unknown[] {
  n = n + 1
  console.log("eval#" + String(n) + " " + tag)
  return v
}
const xs: unknown[] = ["x1", "x2"]
const ys: unknown[] = ["y1"]

console.log("A f(a, ...xs, b)")
take(ev("a", "A"), ...evArr("xs", xs), ev("b", "B"))

console.log("B f(...xs, ...ys)")
take(...evArr("xs", xs), ...evArr("ys", ys))

console.log("C f(a, ...xs, b, ...ys, c)")
take(ev("a", "A"), ...evArr("xs", xs), ev("b", "B"), ...evArr("ys", ys), ev("c", "C"))

console.log("D f(...xs) only")
take(...evArr("xs", xs))

console.log("E fixed prefix then spread")
function pre(a: unknown, b: unknown, ...rest: unknown[]): void {
  console.log("  -> a=" + String(a) + " b=" + String(b) + " " + fmt(rest))
}
pre(ev("p1", 1), ev("p2", 2), ...evArr("xs", xs), ev("tail", "T"))
