// A Map or Set keyed by an entry read off a table, looked up with the same entry read through a widening cast of that table, finds it:
// the cast is a view, so one object however often it is read off. Map, Set, WeakMap, indexOf and includes all see one pointer.
interface Entry { code: number; flag: boolean | number }
const TABLE = {
  alpha: { code: 1, flag: true },
  beta: { code: 2, flag: 0 },
}
type Name = keyof typeof TABLE
type Wide = Record<Name, Entry>
const WIDE = TABLE as Wide
const registry = new Map<Entry, string>()
registry.set(TABLE.alpha, "first")
registry.set(WIDE.beta, "second")
console.log(registry.get(WIDE.alpha), registry.has(WIDE.alpha), registry.get(WIDE.beta), registry.get(TABLE.beta), registry.size)
const seen = new Set<Entry>([WIDE.beta])
console.log(seen.has(WIDE.beta), seen.has(TABLE.beta), seen.has(WIDE.alpha))
const wm = new WeakMap<Entry, number>()
wm.set(WIDE.alpha, 5)
console.log(wm.get(WIDE.alpha), wm.get(TABLE.alpha), wm.has(WIDE.beta))
const list: Entry[] = [WIDE.alpha, WIDE.beta]
console.log(list.indexOf(WIDE.beta), list.includes(WIDE.alpha), list.indexOf(WIDE.beta))
function same(a: Entry, b: Entry): boolean { return a === b }
console.log(same(WIDE.alpha, TABLE.alpha), same(WIDE.alpha, WIDE.beta))
// a write through the original is seen through the cast, and the identity survives it
const held = WIDE.alpha
TABLE.alpha.code = 41
console.log(held.code, WIDE.alpha.code, registry.get(WIDE.alpha), same(held, WIDE.alpha))
WIDE.beta.code = 77
console.log(TABLE.beta.code, registry.get(WIDE.beta))
// many reads come and go: nothing stale is ever answered for a new object
let hits = 0
for (let i = 0; i < 2000; i++) {
  const t = { a: { code: i, flag: i % 2 === 0 } }
  const w = t as Record<"a", Entry>
  const m = new Map<Entry, number>()
  m.set(t.a, i)
  if (m.get(w.a) === i) hits++
}
console.log(hits)
