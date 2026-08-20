// The census-raising hazard, armed against: `switch (t)` on a local that a
// widened keyed read was assigned into is lowered by `lowerUnionSwitch`,
// and that desugar REFUSES several clause shapes the primitive switch
// lowers happily — a non-literal case test, real fall-through between
// bodies, a conditional early `break`, a `break label`. Widening without
// asking first would turn every one of them into an SC1090 REFUSAL:
// a compile-time kill traded for a runtime one, which raises the refusal
// census instead of lowering it.
//
// So the rung asks first, through the very predicates the desugar uses
// (`unionSwitchStrayBreak`, `unionSwitchClauseFallsThrough`), and a shape
// it would refuse keeps today's lowering unchanged. Every function below
// therefore DECLINES, and a decline is observable here only as "the
// program compiles and the answer is what it was" — so every row supplies
// the key.
//
// The byte-level statement of the same thing lives in
// `packages/compiler/test/assignarm-dials.test.ts`: a declining program
// emits a TU that is byte-for-byte identical with the rungs on and with
// every dial off.
//
// Dial: `SCRIPTC_SWLOCAL_OFF=1` ablates the switch rung; nothing here
// moves, because nothing here takes it.

type Attrs = Record<string, string>

// A case test that is not a string literal: the fall to `default` stops
// being a fact about the program and becomes a bet about a runtime value.
const ALPHA = "alpha"
function nonLiteral(attrs: Attrs): string {
  let t: string | undefined
  t = attrs.type
  switch (t) {
    case ALPHA:
      return "A"
    default:
      return "D"
  }
}
console.log("d00", nonLiteral({ type: "alpha" }), nonLiteral({ type: "beta" }))

// Real FALL-THROUGH between two non-empty bodies: an if/else chain has no
// shape for it.
function fallsThrough(attrs: Attrs): string {
  let out = ""
  let t: string | undefined
  t = attrs.type
  switch (t) {
    case "p":
      out += "P"
    case "q":
      out += "Q"
      break
    default:
      out += "D"
  }
  return out
}
console.log("d01", fallsThrough({ type: "p" }), fallsThrough({ type: "q" }), fallsThrough({ type: "z" }))

// A CONDITIONAL early break: desugared, it would bind to an enclosing loop
// instead of to this switch.
function earlyBreak(attrs: Attrs): string {
  let out = ""
  let t: string | undefined
  t = attrs.type
  switch (t) {
    case "e":
      out += "E"
      if (out.length === 1) break
      out += "!"
      break
    default:
      out += "D"
  }
  return out
}
console.log("d02", earlyBreak({ type: "e" }), earlyBreak({ type: "z" }))

// A LABELED break naming the switch.
function labelled(attrs: Attrs): string {
  let s = ""
  let t: string | undefined
  t = attrs.type
  outer: switch (t) {
    case "l": {
      s += "L"
      break outer
    }
    default:
      s += "?"
  }
  return s
}
console.log("d03", labelled({ type: "l" }), labelled({ type: "z" }))

// A NUMERIC discriminant: the slot is `number | undefined`, the case tests
// are numeric literals, and the string-literal restriction declines it.
function numeric(attrs: Record<string, number>): string {
  let n: number | undefined
  n = attrs.n
  switch (n) {
    case 1:
      return "one"
    default:
      return "other"
  }
}
console.log("d04", numeric({ n: 1 }), numeric({ n: 2 }))

// And the shape that DOES take the rung, beside them, so this fixture is
// not merely a list of things that do nothing: the same dispatch with
// string-literal tests, no fall-through and no stray break, answered on an
// ABSENT key.
function served(attrs: Attrs): string {
  let t: string | undefined
  t = attrs.type
  switch (t) {
    case "msg":
      return "M"
    default:
      return "D"
  }
}
console.log("d10", served({ type: "msg" }), served({}))

console.log("d99 still running")
