// The write side, and the lifetime of what is written. Values of every
// overflow-store kind go IN through the index -- primitives, a record, an
// array, a Map, a Set, a class instance, a function, null and undefined --
// and come back out at their own static types, in a loop so a leak or a
// double-release shows. A hybrid's declared slot keeps its struct field
// while the store fills around it.
interface Doc { [key: string]: any }
interface Hybrid { _id: string; [key: string]: any }
interface Pair { a: number; b: string }
class Node_ { id: number; next: Node_ | null = null; constructor(id: number) { this.id = id } }

function round(i: number): string {
  const d: Doc = {}
  d.n = i
  d['s'] = 's' + i
  d.b = i % 2 === 0
  d.rec = { a: i, b: 'r' } as Pair
  d.arr = [i, i + 1]
  d.map = new Map<string, number>([['k', i]])
  d.set = new Set<number>([i])
  d.node = new Node_(i)
  d.fn = (x: number) => x + i
  d.nul = null

  const n: number = d.n
  const s: string = d.s
  const b: boolean = d.b
  const rec: Pair = d.rec
  const arr: number[] = d.arr
  const map: Map<string, number> = d.map
  const set: Set<number> = d.set
  const node: Node_ = d.node
  const fn: (x: number) => number = d.fn

  // an owning cycle built and broken by hand, through the store
  const other = new Node_(i + 100)
  node.next = other
  other.next = node
  const chained = node.next ? node.next.id : -1
  node.next = null
  other.next = null

  d.n = n + 1
  const bumped: number = d.n

  return [
    String(n), s, String(b), String(rec.a) + rec.b, String(arr.length),
    String(map.get('k')), String(set.has(i)), String(node.id), String(fn(1)),
    String(d.nul === null), String(chained), String(bumped),
    Object.keys(d).sort().join('|'),
  ].join(',')
}

for (let i = 0; i < 4; i++) console.log(round(i))

const h: Hybrid = { _id: 'x' }
for (let i = 0; i < 3; i++) {
  h['k' + i] = i
  h._id = 'x' + i
}
console.log(h._id, Object.keys(h).join(','), JSON.stringify(h))
