// The layout half. Two instantiations of one split family carry different
// field TYPES in the same slots; a third class fixes the parameter and adds
// its own field below. Every read goes through a base-typed reference, so a
// prefix that disagreed by one slot would print the wrong value silently.
// The statics stay on the family — one storage location for every
// instantiation, which is what JS's single runtime class has.
class Cell<T> {
  head: T
  n: number
  constructor(head: T, n: number) { this.head = head; this.n = n }
  get1(): T { return this.head }
  kind(): string { return 'cell' }
}
class Pair<T> extends Cell<T> {
  tail: T
  constructor(h: T, t: T, n: number) { super(h, n); this.tail = t }
  kind(): string { return 'pair' }
  both(): string { return String(this.head) + '/' + String(this.tail) + '#' + this.n }
  static made = 0
  static bump(): number { Pair.made = Pair.made + 1; return Pair.made }
}
class StrPair extends Pair<string> {
  extra: boolean
  constructor(h: string, t: string, n: number, e: boolean) { super(h, t, n); this.extra = e }
  kind(): string { return 'strpair' + (this.extra ? '!' : '') }
}

const pi: Cell<number> = new Pair<number>(1, 2, 10)
const ps: Cell<string> = new Pair<string>('a', 'b', 20)
const sp: Cell<string> = new StrPair('c', 'd', 30, true)
console.log(pi.kind(), ps.kind(), sp.kind())
console.log(pi.get1(), ps.get1(), sp.get1())
console.log(pi.n, ps.n, sp.n)
const p1n = new Pair<number>(5, 6, 40)
const p1s = new Pair<string>('e', 'f', 50)
const p1x = new StrPair('g', 'h', 60, false)
console.log(p1n.both(), p1s.both(), p1x.both(), p1x.extra)
console.log(Pair.bump(), Pair.bump(), Pair.made)
const plain: Cell<number> = new Cell<number>(7, 70)
console.log(plain.kind(), plain.get1(), plain.n)
