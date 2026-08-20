// `t.length` where `t` is a local a widened index-signature keyed read was
// assigned into — 5601's r13, the one of its six declining spellings that
// cannot be answered with a VALUE.
//
// tsc narrows an assignment to the declared type filtered by the type
// assigned, so `t` reads `string` at the member access and the read
// bridges through the checked extraction. On base the assignment does not
// widen at all and the miss ABORTS the process; with the rung on and this
// one piece off, the bridge throws
//
//     undefined is not representable in the target union
//     (a value narrowed or asserted past it still held it)
//
// where Node throws
//
//     Cannot read properties of undefined (reading 'length')
//
// Both are catchable TypeErrors at the same point in the control flow. The
// difference is one string — the one `e.message` prints, the one a `catch`
// that matches on text sees, and the one a byte comparison against the
// Node oracle reads. The RECEIVER position is the single position where JS
// itself throws for the unit, so it is the single position where this
// compiler can be Node-exact rather than merely loud.
//
// The lowering is a TAG TEST in front of the ordinary bridge — no helper is
// interned, nothing is added to the TU, and on an honest narrowing the test
// is a compare against a tag word that never matches.
//
// Dial: `SCRIPTC_RECVARM_OFF=1` keeps the family message (the program still
// runs, still throws, still exits 0 — only the text differs, which is
// exactly why this fixture prints the text). `SCRIPTC_ASSIGNARM_OFF=1`
// aborts the process on every `miss` row.

type Attrs = Record<string, string>

function caught(f: () => string): string {
  try {
    return f()
  } catch (e) {
    return "THREW " + (e as Error).name + ": " + (e as Error).message
  }
}

// ------------------------------------------------- a property read
function lengthOf(attrs: Attrs): string {
  let t: string | undefined
  t = attrs.type
  return String(t.length)
}
console.log("m00", caught(() => lengthOf({ type: "msg" })))
console.log("m01", caught(() => lengthOf({})))

// ------------------------------------------------- a METHOD call
function upper(attrs: Attrs): string {
  let t: string | undefined
  t = attrs.type
  return t.toUpperCase()
}
console.log("m10", caught(() => upper({ type: "msg" })))
console.log("m11", caught(() => upper({})))

// ---------------------------------- the key names itself in the message
function slicedAt(attrs: Attrs): string {
  let t: string | undefined
  t = attrs.other
  return t.slice(0, 2)
}
console.log("m20", caught(() => slicedAt({ other: "abcd" })))
console.log("m21", caught(() => slicedAt({})))

// ------------------------------------------ `?.` short-circuits instead
// The optional form is not a throw at all: JS answers undefined, and the
// optional-chain machinery already did. It is here so that "the receiver
// rung fires on every member read" would be visible as a WRONG answer.
function optional(attrs: Attrs): string {
  let t: string | undefined
  t = attrs.type
  return String(t?.length)
}
console.log("m30", optional({ type: "msg" }), optional({}))

// ---------------------------------------------------- the guard first
// The idiom the throw exists to make unnecessary: the author's own test
// runs before the member read, so the tag test in front of the bridge is
// false and the read is the read it always was.
function guardedLength(attrs: Attrs): string {
  let t: string | undefined
  t = attrs.type
  if (t === undefined) return "(none)"
  return String(t.length)
}
console.log("m40", guardedLength({ type: "msg" }), guardedLength({}))

// ------------------------------------------------------------ CONTROL
// A receiver that is NOT one of this family's locals: `x!` on a union is
// the same checked extraction and keeps the family message, because the
// assertion is the author's claim rather than a keyed read's silence.
function asserted(v: string | undefined): string {
  return caught(() => String(v!.length))
}
console.log("c50", asserted("abc"))

console.log("m99 still running")
