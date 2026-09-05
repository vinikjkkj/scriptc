// Lifetime across a split boundary: a split generic holding refcounted
// fields, an owning cycle built and broken by hand, instances reached and
// dropped through a base-typed slot, at two instantiations, in a loop. The
// base a split instantiation extends is not the family, so the release path
// walks a chain this file is the only corpus program to build.
class Holder<T> {
  items: T[] = []
  add(v: T): void { this.items.push(v) }
  size(): number { return this.items.length }
}
class Named<T> extends Holder<T> {
  name: string
  peer: Named<T> | null = null
  constructor(name: string) { super(); this.name = name }
  size(): number { return this.items.length * 2 }
}
function run(): string {
  const a = new Named<string>('a')
  const b = new Named<string>('b')
  a.peer = b
  b.peer = a
  a.add('x'); a.add('y'); b.add('z')
  const h: Holder<string> = a
  const out = h.size() + ':' + b.size() + ':' + (a.peer ? a.peer.name : '-')
  a.peer = null
  b.peer = null
  return out
}
function run2(): number {
  const n = new Named<number>('n')
  n.add(1); n.add(2); n.add(3)
  const h: Holder<number> = n
  return h.size()
}
for (let i = 0; i < 3; i++) console.log(run(), run2())
