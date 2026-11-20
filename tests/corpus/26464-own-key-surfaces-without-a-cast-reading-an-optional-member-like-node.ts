// The control for 26463: the same record and class-instance values with NO cast anywhere reading an optional member. Their shapes
// must be exactly what they were before the cast scan existed (the emitted program is byte-identical).
interface Plain { id: number }
interface Other { load(): number }
class ImplO implements Other { load() { return 1 } destroy() {} }
class BareO implements Other { load() { return 2 } }
function show(label: string, v: object): void {
  const k: string[] = []
  for (const key in v) k.push(key)
  console.log(label, Object.keys(v).join("|"), JSON.stringify(v), k.join("|"), JSON.stringify({ ...v }), "id" in v, "tag" in v, "load" in v, "destroy" in v)
}
const c: Plain = { id: 3, tag: "y" } as Plain
const d: Plain = { id: 4 }
const o1: Other = new ImplO()
const o2: Other = new BareO()
show("plain-set", c)
show("plain-unset", d)
show("other-set", o1)
show("other-unset", o2)
