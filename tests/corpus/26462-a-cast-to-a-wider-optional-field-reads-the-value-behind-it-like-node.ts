// A data member (not a method) and two assertions with different optional members: the literal behind the narrow type holds `tag`, the other does not.
interface Item { id: number }
function make(withTag: boolean): Item {
  const o = withTag ? { id: 1, tag: "hot" } : { id: 2 }
  return o
}
function tagOf(x: Item): string {
  const a = x as { tag?: string }
  const b = x as { tag?: string; extra?: number }
  return String(a.tag) + "/" + String(b.tag) + String(b.extra)
}
console.log(tagOf(make(true)), tagOf(make(false)))
const items = [make(true), make(false), make(true)]
console.log(items.map(tagOf).join(","), items.length)
