// `const B = Impl as unknown as BCtor; class D extends B {}` — the shape bson
// uses to give `Timestamp` a `Long` base minus the members it redeclares. The
// casts are erasure: the VALUE is that class's static side, so `new B()`
// already resolved to it and the `extends` clause has to name the same class
// or two spellings of one thing disagree. The published instance type is a
// mapped VIEW of the class — a type-world subset of the same layout.
class Num {
  low: number
  high: number
  constructor(low: number, high: number) { this.low = low; this.high = high }
  toString(): string { return 'Num(' + this.low + ',' + this.high + ')' }
  add(o: Num): Num { return new Num(this.low + o.low, this.high + o.high) }
}
type NumCtor = new (low: number, high: number) => { low: number; high: number; toString(): string }
const NumBase: NumCtor = Num as unknown as NumCtor

class Stamp extends NumBase {
  constructor(low: number, high: number) { super(low, high) }
  toString(): string { return 'Stamp(' + this.low + ',' + this.high + ')' }
}

const s = new Stamp(1, 2)
const n = new Num(3, 4)
console.log(s.toString(), n.toString())
console.log(s.low, s.high, n.low, n.high)
const arr: { toString(): string }[] = [s, n]
for (const x of arr) console.log(x.toString())
