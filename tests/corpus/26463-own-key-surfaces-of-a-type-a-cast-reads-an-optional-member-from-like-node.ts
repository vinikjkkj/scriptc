// Object.keys, JSON.stringify, for...in, spread and `in` over values whose static type some cast reads an optional member from
// (Item, Store), in three states: the member set, unset, and a type no cast reads (Plain, Other) that must be unaffected.
interface Item { id: number }
interface Store { load(): number }
interface Plain { id: number }
interface Other { load(): number }
class Impl implements Store { load() { return 1 } destroy() {} }
class Bare implements Store { load() { return 2 } }
class ImplO implements Other { load() { return 1 } destroy() {} }
function viaCast(x: Item): string { return String((x as { tag?: string }).tag) }
function viaCastS(s: Store): string { return typeof (s as { destroy?: () => void }).destroy }
function show(label: string, v: object): void {
  const k: string[] = []
  for (const key in v) k.push(key)
  console.log(label, Object.keys(v).join("|"), JSON.stringify(v), k.join("|"), JSON.stringify({ ...v }), "id" in v, "tag" in v, "load" in v, "destroy" in v)
}
const a: Item = { id: 1, tag: "x" } as Item
const b: Item = { id: 2 }
const c: Plain = { id: 3, tag: "y" } as Plain
const d: Plain = { id: 4 }
console.log(viaCast(a), viaCast(b))
show("item-set", a)
show("item-unset", b)
show("plain-set", c)
show("plain-unset", d)
const s1: Store = new Impl()
const s2: Store = new Bare()
const o1: Other = new ImplO()
console.log(viaCastS(s1), viaCastS(s2))
show("store-set", s1)
show("store-unset", s2)
show("other", o1)
