// `firstEncType = child.attrs.type`, and then READING it — the six
// spellings fixture 5601 records as declining, closed.
//
// 5601's rung took the assignment; its own controls say why it took
// almost nothing else: tsc narrows an assignment to the declared type
// filtered by the type assigned, so the very NEXT read of `v` after
// `v = attrs.v` is already spelled `string` — `v === undefined` and
// `v ?? d` included, the two reads whose whole point is the arm the
// narrow just removed. Six of seven spellings declined and kept the
// loud trap.
//
// THE GROUND FOR THAT GATE WAS STALE PROSE. It said a narrowed read
// lowers to an UNCHECKED `unionNarrow`, so a stored `undefined` becomes a
// silent wrong value. It does not, and has not since `733f4db9` made
// every checker-driven narrowing go through `checkedArmBridge` ->
// `narrowedArmHelper`, which emits `if (unionIsTag) throw new TypeError`
// BEFORE the payload peek. The gate is retired and each consumer now gets
// the answer the unit arm actually has:
//
//   `v === undefined` / `v == null` / `!v` / `typeof v`  the tag test
//   `v ?? d`                                             nullarm
//   `v === "lit"` / `v !== "lit"`                        eqarm
//   `switch (v)`                                         swlocal
//   `String(v)` / `"a" + v` / `` `${v}` ``               strarm
//   `v.length` / `v.toUpperCase()`                       recvarm, and
//                                                        Node's own message
//
// Every row below runs its function TWICE — once with the key present and
// once with it ABSENT. On base every ABSENT call is a process ABORT
// (0xC0000409, past every catch clause); under Node they are ordinary
// values.
//
// Dials, each proven load-bearing on its own rows:
//   SCRIPTC_ASSIGNARM_OFF=1  the whole rung — every absent row aborts
//   SCRIPTC_NULLARM_OFF=1    r21, r22
//   SCRIPTC_EQARM_OFF=1      r30, r31, r32
//   SCRIPTC_SWLOCAL_OFF=1    r40, r41, r42
//   SCRIPTC_STRARM_OFF=1     r50, r51, r52, r53
//   SCRIPTC_RECVARM_OFF=1    5731's rows (the message, not the control flow)

type Attrs = Record<string, string>

// ------------------------------------------------- the guard spellings
// 5601 r10: the idiomatic early exit. The read after the guard is a plain
// value use, so the checked bridge rides it — and passes, because the
// guard really did exit.
function labelOf(attrs: Attrs): string {
  let label: string | undefined
  label = attrs.label
  if (label === undefined) return "(none)"
  return label
}
console.log("r10", labelOf({ label: "hi" }), labelOf({}))

function labelOfNeq(attrs: Attrs): string {
  let label: string | undefined
  label = attrs.label
  if (label !== undefined) return "hit:" + label
  return "(none)"
}
console.log("r11", labelOfNeq({ label: "hi" }), labelOfNeq({}))

// The LOOSE pair — one test for both units.
function looseNull(attrs: Attrs): string {
  let v: string | undefined
  v = attrs.v
  if (v == null) return "(none)"
  return v
}
console.log("r12", looseNull({ v: "x" }), looseNull({}))

function banged(attrs: Attrs): string {
  let v: string | undefined
  v = attrs.v
  if (!v) return "(none)"
  return v
}
console.log("r13", banged({ v: "x" }), banged({}), banged({ v: "" }))

function typeofArm(attrs: Attrs): string {
  let v: string | undefined
  v = attrs.v
  return typeof v
}
console.log("r14", typeofArm({ v: "x" }), typeofArm({}))

// 5601 r12: the element-access spelling, and the ternary rather than the
// statement `if`.
function elemSpelling(attrs: Attrs, k: string): string {
  let v: string | undefined
  v = attrs[k]
  return v === undefined ? "miss" : "hit:" + v
}
console.log("r15", elemSpelling({ a: "1" }, "a"), elemSpelling({ a: "1" }, "z"))

// 5601 r16: a narrow the checker PROVED with a test, in the false arm of a
// conditional — the shape the old gate named as its reason for declining
// even provably-sound narrows.
function provenNarrow(attrs: Attrs): string {
  let v: string | undefined
  v = attrs.v
  const a = v === undefined ? "u" : v
  return a
}
console.log("r16", provenNarrow({ v: "first" }), provenNarrow({}))

// ------------------------------------------------------ nullish (r2x)
// 5601 r11.
function withDefault(attrs: Attrs): string {
  let v: string | undefined
  v = attrs.v
  return v ?? "dflt"
}
console.log("r21", withDefault({ v: "yes" }), withDefault({}))

// A CHAIN: the middle operand is itself a widened read, and both keys can
// be absent.
function chained(attrs: Attrs): string {
  let v: string | undefined
  v = attrs.v
  return v ?? attrs.other ?? "tail"
}
console.log("r22", chained({ v: "a", other: "b" }), chained({ other: "b" }), chained({}))

// ----------------------------------------- comparison to a literal (r3x)
// The compare has an answer for the unit arm — `undefined === "msg"` is
// false — exactly as `=== undefined` does. It is lowered as a TAG TEST
// plus the same `strEq` against the same static literal the un-widened
// program emitted, so it does NOT allocate the way `unionEq` does.
function eqLit(attrs: Attrs): string {
  let t: string | undefined
  t = attrs.type
  return t === "msg" ? "yes" : "no"
}
console.log("r30", eqLit({ type: "msg" }), eqLit({ type: "x" }), eqLit({}))

function neqLit(attrs: Attrs): string {
  let t: string | undefined
  t = attrs.type
  return t !== "msg" ? "other" : "msg"
}
console.log("r31", neqLit({ type: "msg" }), neqLit({ type: "x" }), neqLit({}))

// The literal on the LEFT: the rung asks both operands.
function eqLitFlipped(attrs: Attrs): string {
  let t: string | undefined
  t = attrs.type
  return "msg" === t ? "yes" : "no"
}
console.log("r32", eqLitFlipped({ type: "msg" }), eqLitFlipped({}))

// ------------------------------------------------------- switch (r4x)
// The zapo dispatch one binding later. `switch (undefined)` matches no
// case and takes `default` — which the author wrote.
function dispatch(attrs: Attrs): string {
  let t: string | undefined
  t = attrs.type
  switch (t) {
    case "skmsg":
      return "S"
    case "msg":
    case "pkmsg":
      return "M"
    default:
      return "D"
  }
}
console.log("r40", dispatch({ type: "skmsg" }), dispatch({ type: "pkmsg" }), dispatch({ type: "zz" }), dispatch({}))

// BRACED case bodies, which is how zapo writes them.
function dispatchBraced(attrs: Attrs): string {
  let out = ""
  let t: string | undefined
  t = attrs.type
  switch (t) {
    case "skmsg": {
      const tag = "S"
      out += tag
      break
    }
    default: {
      out += "D"
      break
    }
  }
  return out
}
console.log("r41", dispatchBraced({ type: "skmsg" }), dispatchBraced({}))

// NO default at all: the switch falls out of the bottom.
function dispatchNoDefault(attrs: Attrs): string {
  let t: string | undefined
  t = attrs.type
  switch (t) {
    case "msg":
      return "M"
  }
  return "fell"
}
console.log("r42", dispatchNoDefault({ type: "msg" }), dispatchNoDefault({}))

// -------------------------------------------- string conversion (r5x)
// ToString is TOTAL over this width — the unit arm's text is the four
// letters `undefined`, which is what Node prints.
function stringCall(attrs: Attrs): string {
  let v: string | undefined
  v = attrs.v
  return String(v)
}
console.log("r50", stringCall({ v: "x" }), stringCall({}))

function concatLeft(attrs: Attrs): string {
  let v: string | undefined
  v = attrs.v
  return "<" + v + ">"
}
console.log("r51", concatLeft({ v: "x" }), concatLeft({}))

function concatRight(attrs: Attrs): string {
  let v: string | undefined
  v = attrs.v
  return v + "!"
}
console.log("r52", concatRight({ v: "x" }), concatRight({}))

function templated(attrs: Attrs): string {
  let v: string | undefined
  v = attrs.v
  return `[${v}]`
}
console.log("r53", templated({ v: "x" }), templated({}))

// ----------------------------------------------------------- CONTROLS
// A slot with NO undefined arm is not this rung's business: `let t =
// "start"` is inferred `string`, and widening it would mean widening the
// LOCAL, which every read of it was compiled against. A miss here still
// aborts, and that is stated rather than hidden — the key is supplied.
function noArm(attrs: Attrs): string {
  let t = "start"
  t = attrs.type
  return t
}
console.log("c60", noArm({ type: "abc" }))

// A DECLARATION is decided by its own rungs (keyedReadLocalAtDynWidth),
// not by this one, and the answer they already gave must not move.
function declared(attrs: Attrs): string {
  const t = attrs.type
  return t === undefined ? "miss" : "hit:" + t
}
console.log("c61", declared({ type: "q" }), declared({}))

// An assignment from something that is NOT a keyed read: nothing to widen,
// and the local is not in this family's population at all.
function fromCall(attrs: Attrs): string {
  const mk = (): string | undefined => (attrs.v === "" ? undefined : attrs.v)
  let v: string | undefined
  v = mk()
  return v === undefined ? "u" : v
}
console.log("c62", fromCall({ v: "z" }))

// A SECOND assignment overwrites the first: the reads after it see the
// second read's presence, not the first's.
function reassigned(attrs: Attrs): string {
  let t: string | undefined
  t = attrs.type
  t = attrs.other
  return t ?? "(none)"
}
console.log("c63", reassigned({ type: "a", other: "b" }), reassigned({ type: "a" }), reassigned({}))

// The local read from a NESTED function, where the checker's narrowing of
// the outer binding does not reach.
function nested(attrs: Attrs): string {
  let v: string | undefined
  v = attrs.v
  const f = (): string => String(v)
  return f()
}
console.log("c64", nested({ v: "n" }), nested({}))

console.log("r99 still running")
