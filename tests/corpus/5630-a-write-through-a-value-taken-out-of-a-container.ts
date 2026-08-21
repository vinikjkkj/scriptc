// A value taken OUT of a container and then written through — the aliasing
// half of the static/dyn boundary, pinned on the side that works.
//
// scriptc keeps a composite in two physically different shapes: a monomorphic
// C struct (record) or a packed array, and a `ScrDyn` key-value table.
// Whenever a value crosses between them the runtime COPIES, because the two
// representations cannot alias. The project already fences the static->dyn
// direction: `dynCopyIsObservable` wraps the copy in
// `scr_dyn_mark_static_copy`, and a write through the marked dyn refuses
// loudly rather than being dropped.
//
// Every row below stays on ONE side of that boundary, so every write must
// land on the caller's object exactly as it does in Node. They are the rows a
// regression to copy-on-read would break first, and none of them was covered:
// a typed keyed read, a function that hands a nested object back, a member
// access, an array element, a class instance living in a map, and the same
// object reached twice by two different routes.
//
// What is NOT here, and why. The row that CROSSES the boundary —
//
//     const v = (message as unknown as Record<string, unknown>)[key]
//     ;(v as Carrier).contextInfo = { stanzaId: "X" }
//
// — used to diverge: Node wrote the caller's submessage, scriptc wrote a
// struct `sc_dc_N` freshly allocated out of the dyn and the store was lost in
// silence. It stayed out of this file because this file is byte-compared
// against Node and that row did not match.
//
// It matches now. A mutation whose receiver is SYNTACTICALLY an assertion
// over a checked-dynamic value keeps the receiver dyn instead of recovering
// a static composite first, so the store reaches the object the program
// still names. That row and the other nine surfaces of its family live in
// `tests/corpus/5631-a-mutation-through-an-asserted-unknown.ts`.
//
// What is still not here is the same defect reached through a NAME
// (`const r = u as T; r.k = v`) or across a CALL — including zapo's own
// two-function spelling, where `pickContextInfoTarget` returns the recovery
// and `applyContextInfo` writes it. No syntactic rule can see those; they
// need the recovered value itself to carry its origin. Their count and their
// named site stay pinned in
// `tests/harness/payload-alias-accounting.test.ts`.

interface Ctx {
  stanzaId?: string
  participant?: string
}
interface Carrier {
  text?: string
  contextInfo?: Ctx
}

// ---------------------------------------------- a TYPED keyed read aliases
const byKey: Record<string, Carrier> = { sub: { text: "hi" } }
const t1 = byKey["sub"]
t1.contextInfo = { stanzaId: "A" }
console.log("r01", JSON.stringify(byKey))

// the same read a second time hands back the same object
const t2 = byKey["sub"]
console.log("r02", t2.contextInfo === undefined ? "lost" : String(t2.contextInfo.stanzaId))

// ------------------------------------- a FUNCTION that hands the value back
function pick(m: Record<string, Carrier>): Carrier | null {
  for (const key of Object.keys(m)) {
    return m[key]
  }
  return null
}
const byKey2: Record<string, Carrier> = { only: { text: "second" } }
const t3 = pick(byKey2)
if (t3 !== null) {
  t3.contextInfo = { stanzaId: "B", participant: "p@s" }
}
console.log("r03", JSON.stringify(byKey2))

// ----------------------------------------------- a plain MEMBER access
const nested: { sub: Carrier } = { sub: {} }
const t4 = nested.sub
t4.text = "member"
t4.contextInfo = { stanzaId: "C" }
console.log("r04", JSON.stringify(nested))

// ----------------------------------------------- an ARRAY element
const list: Carrier[] = [{ text: "zero" }, { text: "one" }]
const t5 = list[1]
t5.contextInfo = { stanzaId: "D" }
list[0].text = "changed"
console.log("r05", JSON.stringify(list))

// a nested array inside a record, reached through the record
const holder: { rows: Carrier[] } = { rows: [{ text: "row" }] }
holder.rows[0].contextInfo = { participant: "q@s" }
const t6 = holder.rows[0]
t6.text = "row!"
console.log("r06", JSON.stringify(holder))

// ------------------------------------------ a CLASS instance in a container
class Node2 {
  public label = "start"
  public seen = 0
  public bump(by: number): void {
    this.seen += by
  }
}
const nodes: Record<string, Node2> = { a: new Node2() }
const n1 = nodes["a"]
n1.label = "moved"
n1.bump(3)
nodes["a"].bump(4)
const nBack = nodes["a"]
console.log("r07", nBack.label, nBack.seen, n1.seen === nBack.seen)

// -------------------------------- TWO routes to the same object must agree
const shared: Carrier = { text: "shared" }
const box: { one: Carrier; two: Carrier } = { one: shared, two: shared }
box.one.contextInfo = { stanzaId: "E" }
console.log("r08", JSON.stringify(box.two), box.one === box.two)

// ------------------------ a value passed INTO a function and mutated there
function stamp(c: Carrier, id: string): void {
  c.contextInfo = { stanzaId: id }
}
const target: Carrier = { text: "stamped" }
stamp(target, "F")
console.log("r09", JSON.stringify(target))

// the same, one level down: the callee takes it out of the container itself
function stampIn(m: Record<string, Carrier>, key: string, id: string): void {
  const c = m[key]
  c.contextInfo = { stanzaId: id }
}
const byKey3: Record<string, Carrier> = { k: { text: "inner" } }
stampIn(byKey3, "k", "G")
console.log("r10", JSON.stringify(byKey3))

// ------------------------------------------------- a MAP of arrays of records
const groups = new Map<string, Carrier[]>()
groups.set("g", [{ text: "in-map" }])
const arr = groups.get("g")
if (arr !== undefined) {
  arr[0].contextInfo = { stanzaId: "H" }
  arr.push({ text: "appended" })
}
const back = groups.get("g")
console.log("r11", back === undefined ? "gone" : JSON.stringify(back))

// ------------------------------------------------------------- CONTROLS
// A SPREAD is a copy on both sides, and must stay one.
const src: Carrier = { text: "src", contextInfo: { stanzaId: "I" } }
const copy: Carrier = { ...src }
copy.text = "copy"
console.log("r12", String(src.text), String(copy.text), src.contextInfo === copy.contextInfo)

// A shallow spread SHARES the nested object on both sides, so a write into
// the copy's nested object is visible through the source's.
const copyCtx = copy.contextInfo
if (copyCtx !== undefined) {
  copyCtx.participant = "r@s"
}
const srcCtx = src.contextInfo
console.log("r13", srcCtx === undefined ? "gone" : JSON.stringify(srcCtx))

// Deleting through one route is visible through the other.
const delBox: Record<string, Carrier> = { d: { text: "del", contextInfo: { stanzaId: "J" } } }
const d1 = delBox["d"]
delete d1.contextInfo
console.log("r14", JSON.stringify(delBox), d1.contextInfo === undefined)

console.log("r99 still running")
