// A two-step chain on a narrowed receiver: the inner `?.` returns a union
// body, the outer `?.` reads a method of its record arm. Statement form and
// value form both, with a receiver that holds null at run time.
class Leaf {
  k: number
  constructor(k: number) { this.k = k }
  bump(): void { this.k = this.k + 1; console.log("bump", this.k) }
  val(): number { return this.k }
}
class Holder {
  leaf: Leaf | null
  constructor(l: Leaf | null) { this.leaf = l }
  get(): Leaf | null { return this.leaf }
}

function run(l: Leaf | null) {
  let h: Holder | null = null
  h = new Holder(l)
  const poke = (): void => { void h?.get()?.bump() }
  const read = (): number | null => h?.get()?.val() ?? null
  const pair = (): [number | null, boolean] => [read(), h?.get() === null]
  return { poke, read, pair }
}

const p = run(new Leaf(1))
p.poke()
console.log("T1", p.read(), p.pair())
const q = run(null)
q.poke()
console.log("T2", q.read(), q.pair())
