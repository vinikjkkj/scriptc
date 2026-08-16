// A NAMED function handed to `.map` BY REFERENCE, whose parameter is a
// structurally WIDER record than the array's element.
//
// `hofCallbackArg` admits a callback whose parameter differs from the
// element only by an ARM WRAP (`(Env | null)[]` into `(e: Env | null |
// undefined) => R`), and deliberately refuses a dyn conversion and a
// disposition that can only throw. A WIDTH COPY into an arm is neither: it
// is exactly the conversion a DIRECT call of the same function emits at the
// call argument, which is why `rows.map((r) => parseOne(r))` compiles on
// base and `rows.map(parseOne)` does not:
//   SC2001 values of type '(envelope: Envelope | null | undefined) => Meta'
//   cannot be compiled yet
// zapo hits it twice, `newsletter/discovery.ts:111` and
// `newsletter/parse.ts:226`, where two different mex response shapes are
// mapped through one parser whose parameter is the full envelope.
//
// The copy IS a divergence from Node's aliasing (SEMANTICS.md 35) — and it
// is the SAME divergence the arrow spelling already takes, which is the
// whole argument for admitting the by-reference one. The `sameElement`
// block is the control that the identical-element path is untouched.

type Envelope = {
  readonly id?: string
  readonly state?: { readonly type?: "ACTIVE" | "DELETED" }
  readonly thread_metadata?: { readonly name?: { readonly text?: string }; readonly handle?: string }
}
// Structurally NARROWER: no `state`, no `handle`. tsc admits the flow
// because every field is optional.
type Preview = {
  readonly id?: string
  readonly thread_metadata?: { readonly name?: { readonly text?: string } }
}
interface Meta {
  readonly jid: string
  readonly name: string
  readonly live: boolean
}

function parseOne(envelope: Envelope | null | undefined): Meta {
  return {
    jid: envelope?.id ?? "",
    name: envelope?.thread_metadata?.name?.text ?? "<none>",
    live: envelope?.state?.type === "ACTIVE",
  }
}

const previews: readonly Preview[] = [
  { id: "a", thread_metadata: { name: { text: "Alpha" } } },
  { id: "b" },
  { thread_metadata: { name: { text: "Gamma" } } },
]

// THE REFUSAL on base: the callback VALUE, over the narrower element.
for (const m of previews.map(parseOne)) {
  console.log(m.jid, m.name, m.live)
}

// `forEach` and `filter` take the same route.
previews.forEach(parseOne)
const kept = previews.filter((p) => parseOne(p).name !== "<none>")
console.log(kept.length)

// The absent optionals are COMPLETED in the copy, so a field the element
// type does not have reads as undefined rather than garbage.
console.log(previews.map(parseOne).map((m) => (m.live ? "1" : "0")).join(""))

// THE CONTROL, one: the arrow wrapper, which compiled on base and emits the
// same conversion at the call argument. The two must agree element by
// element.
const viaArrow = previews.map((r) => parseOne(r))
const viaValue = previews.map(parseOne)
console.log(viaArrow.length === viaValue.length)
for (let i = 0; i < viaArrow.length; i++) {
  console.log(viaArrow[i]!.jid === viaValue[i]!.jid, viaArrow[i]!.name === viaValue[i]!.name)
}

// THE CONTROL, two: the element type made IDENTICAL to the parameter's arm.
// This is the path hofCallbackArg already had, and it is an ARM WRAP, not a
// copy.
const sameElement: readonly Envelope[] = [{ id: "z", state: { type: "ACTIVE" } }]
console.log(sameElement.map(parseOne).map((m) => m.jid + ":" + String(m.live)).join(","))

// THE CONTROL, three: a nullable element, which is the arm-wrap rule's own
// second spelling and must be unchanged.
const nullable: readonly (Envelope | null)[] = [{ id: "n" }, null]
console.log(nullable.map(parseOne).map((m) => m.jid || "-").join(","))

// The index/array parameters an HOF may pass are still honoured: a callback
// declaring fewer parameters than the loop offers keeps its arity.
function labelled(envelope: Envelope | null | undefined, i: number): string {
  return String(i) + "=" + (envelope?.id ?? "-")
}
console.log(previews.map(labelled).join(" "))

// An empty receiver visits nothing and still types.
const none: readonly Preview[] = []
console.log(none.map(parseOne).length)
