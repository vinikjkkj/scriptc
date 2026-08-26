// An iterator that THROWS mid-spread. The arguments already evaluated
// must have run; the ones after must not. The SELF-ITERATOR class shape
// carries the protocol so the probe does not depend on a tier this
// compiler has not reached.
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
function ev(tag: string, v: unknown): unknown {
  console.log("  eval " + tag)
  return v
}
function show(tag: string, f: () => void): void {
  try {
    f()
    console.log(tag + ": no throw")
  } catch (e) {
    const m = e instanceof Error ? e.message : String(e)
    console.log(tag + ": caught " + m)
  }
}

class Boom {
  private i = 0
  next() {
    this.i = this.i + 1
    console.log("  next#" + String(this.i))
    if (this.i === 3) throw new Error("iterator exploded at 3")
    return { value: "v" + String(this.i), done: false }
  }
  [Symbol.iterator]() {
    return this
  }
}

console.log("A: iterator throws on the third next()")
show("A", () => { take(...new Boom()) })

console.log("B: arguments before and after a throwing spread")
show("B", () => { take(ev("before", 1), ...new Boom(), ev("after", 2)) })

let reads = 0
class Once {
  private i = 0
  next() {
    this.i = this.i + 1
    return { value: this.i, done: this.i > 2 }
  }
  [Symbol.iterator]() {
    reads = reads + 1
    return this
  }
}
console.log("C: Symbol.iterator is read exactly once")
take(...new Once())
console.log("  Symbol.iterator read " + String(reads) + " time(s)")

console.log("D: a class iterable next to fixed arguments and a second spread")
const xs: unknown[] = ["x"]
take("L", ...new Once(), "M", ...xs, "R")
console.log("  Symbol.iterator read " + String(reads) + " time(s) total")
