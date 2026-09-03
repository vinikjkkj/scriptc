// Two FUNCTION arms in one union, and each value takes its OWN arm.
//
// This is the control for the arm-adapt pass added beside it. A union arm
// can now fill a function slot by ADAPTING a foreign signature, which is
// what an optional member (`f?: (s) => Row` — a `func | undefined` union)
// needs to be fillable from `unknown` at all. The hazard that widening
// has to avoid is putting every callable on the FIRST function arm:
// `((x: number) => string) | ((x: number) => number)` would then hand the
// union the wrong tag for a number-returning value, and the adapter would
// quietly try to convert a return type nobody asked to convert.
//
// It does not, because the adapt pass runs LAST. Every exact-signature
// pass runs first, so a value boxed from an arm's OWN type takes that arm
// whatever order the arms are in — which is why both directions are here:
// one program cannot tell "the exact pass won" from "arm 0 happened to be
// right".
//
// Node has no arms and no adapter: it calls the function it was given and
// answers what the function returns. That is exactly what a correct arm
// selection answers too, which is what makes this differential.

type NumFn = (x: number) => number
type StrFn = (x: number) => string

const numeric: unknown = (x: number) => x * 2
const stringy: unknown = (x: number) => "s" + String(x)

// Arm order as WRITTEN puts the string-returning arm first. A
// number-returning value must still take the second arm.
const a = numeric as StrFn | NumFn
const ra = a(2)
console.log("numeric.type", typeof ra)
console.log("numeric.value", String(ra))

// ...and the mirror, so neither answer can be an accident of order.
const b = stringy as StrFn | NumFn
const rb = b(2)
console.log("stringy.type", typeof rb)
console.log("stringy.value", String(rb))

// The same two values through the OTHER written order.
const c = numeric as NumFn | StrFn
console.log("numeric.flipped", typeof c(3))
const d = stringy as NumFn | StrFn
console.log("stringy.flipped", typeof d(3))

// The undefined-armed spelling an OPTIONAL member takes, which is the
// shape that could not be filled at all before: a function whose own
// signature is NEITHER arm's still lands on the one function arm and is
// adapted, and a MISSING member is still the undefined arm.
type Holder = {
  readonly hit?: (x: number) => number
  readonly miss?: (x: number) => number
}
function makeHolder(): unknown {
  const o: Record<string, unknown> = {}
  o["hit"] = (x: number): unknown => x + 1
  return o
}
const h = makeHolder() as Holder
console.log("optional.present", h.hit !== undefined)
console.log("optional.called", h.hit ? String(h.hit(41)) : "none")
console.log("optional.absent", h.miss === undefined)
