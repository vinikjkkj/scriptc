// The `extends` clause need not mention the parameter directly to make the
// base vary: `class Leaf<T> extends Node_<Leaf<T>>` mentions it THROUGH the
// class itself, so `Leaf<string>` and `Leaf<number>` extend two different
// instantiations of `Node_`. Instantiated twice, with an abstract root whose
// slot every level dispatches through, and instance fields read at each
// instantiation through a reference typed at the root.
abstract class Node_<P> {
  parent: P | null = null
  depth: number
  constructor(d: number) { this.depth = d }
  abstract label(): string
  describe(): string { return this.label() + '@' + this.depth }
}
class Leaf<T> extends Node_<Leaf<T>> {
  payload: T
  constructor(p: T, d: number) { super(d); this.payload = p }
  label(): string { return 'Leaf(' + String(this.payload) + ')' }
}
class NumLeaf extends Leaf<number> {
  label(): string { return 'NumLeaf(' + this.payload + ')' }
}

const a = new Leaf<string>('s', 1)
const b = new Leaf<number>(2, 2)
const c = new NumLeaf(3, 3)
a.parent = new Leaf<string>('root', 0)
b.parent = new Leaf<number>(0, 0)
console.log(a.describe(), b.describe(), c.describe())
const na: Node_<Leaf<string>> = a
const nb: Node_<Leaf<number>> = b
const nc: Node_<Leaf<number>> = c
console.log(na.describe(), nb.describe(), nc.describe())
console.log(na.depth, nb.depth, nc.depth)
console.log(a.parent === null, b.parent === null, c.parent === null)
console.log(a.parent ? a.parent.label() : 'none', b.parent ? b.parent.label() : 'none')
console.log(a.payload, b.payload, c.payload)
