// A MUTATION whose receiver is an ASSERTION between two STATIC shapes, and
// there is no `unknown` anywhere in this file.
//
// 5631 is this file's twin on the dynamic side. Its whole argument is that
// `as` is the IDENTITY in JS — `(a as B).n = 7` writes the very object `a`
// names, and Node has no second object for the store to land on. The same
// sentence is true when NEITHER side is dynamic, and that half was silently
// wrong for longer: a record is a monomorphic C struct, so an assertion
// between two shapes materialised a value of the TARGET shape
// (`sc_f_%rec_width_N` building a fresh `sc_rnew_rB` and copying the fields
// across), the store landed on that temporary, the object the program still
// named was unchanged, nothing trapped, and the process exited 0.
//
// estado-fence.md §3.3 found it while closing the dynamic half, recorded it
// as a THIRD silent wrong answer, and left it open — its point being that
// the family is larger than "the dynamic boundary": it is ANY shape-crossing
// assertion. Every row below answered the pre-mutation value on BOTH
// backends before `staticAssertionOperand`.
//
// Every row reads the mutation back through the name the program still
// holds. Without that readback the copy is unobservable and the row proves
// nothing — the temporary really was written, it was simply not the object
// anyone could see.
//
// WHAT IS NOT HERE. Two rows of this family are still wrong and cannot live
// in a byte-compared file: the recovery bound to a NAME first
// (`const b = a as B; b.n = 7`), which no syntactic rule can see, and a
// write to a field only the ASSERTED type declares (`(a as B).m = 5`), which
// a monomorphic struct has no slot for. Both are pinned in
// tests/harness/dyn-asserted-mutation.test.ts. So is the ordinary width-copy
// binding `const b: B = a`, which is a COERCION and not an assertion, and
// keeps its documented copy.

interface A {
  n: number
}
interface B {
  n: number
  m?: number
}
interface Inner {
  v: number
}

// ------------------------------------------------ the widening assertion
const a1: A = { n: 1 }
;(a1 as B).n = 7
console.log("r01", JSON.stringify(a1))

// ------------------------------------- the NARROWING one, same sentence
interface Wide {
  n: number
  m: number
}
interface Narrow {
  n: number
}
const a2: Wide = { n: 1, m: 2 }
;(a2 as Narrow).n = 7
console.log("r02", JSON.stringify(a2))

// ------------------------------------------------- a non-numeric field
interface S {
  s: string
}
interface S2 {
  s: string
  m?: number
}
const a3: S = { s: "x" }
;(a3 as S2).s = "y"
console.log("r03", JSON.stringify(a3))

// ------------------------------------------ a record-valued field slot
interface I1 {
  i: Inner
}
interface I2 {
  i: Inner
  m?: number
}
const a4: I1 = { i: { v: 1 } }
;(a4 as I2).i = { v: 9 }
console.log("r04", JSON.stringify(a4))

// ---------------------------------------------------- a DOUBLE assertion
// `a as unknown as B` peels to the same operand; the OUTERMOST assertion is
// the one whose target type decides, and the operand is still the record.
const a5: A = { n: 1 }
;((a5 as unknown) as B).n = 7
console.log("r05", JSON.stringify(a5))

// -------------------------------------------- the write inside a callee
// The object crosses a call boundary as a reference, so the callee's
// assertion write must reach the CALLER's object.
function bump(x: A): void {
  ;(x as B).n = 7
}
const a6: A = { n: 1 }
bump(a6)
console.log("r06", JSON.stringify(a6))

// ------------------------------------------------- an OPTIONAL source slot
interface O1 {
  n?: number
}
interface O2 {
  n?: number
  m?: number
}
const a7: O1 = { n: 1 }
;(a7 as O2).n = 7
console.log("r07", JSON.stringify(a7))

const a8: O1 = {}
;(a8 as O2).n = 4
console.log("r08", JSON.stringify(a8))

// --------------------------------------- the destructuring-assign spelling
const a9: A = { n: 1 }
;[(a9 as B).n] = [7]
console.log("r09", JSON.stringify(a9))

// ---------------------------------------------- the BRACKET spelling
// A separate lowering path (the literal-key element write) and it was
// silently wrong in the same way.
const a10: A = { n: 1 }
;(a10 as B)["n"] = 7
console.log("r10", JSON.stringify(a10))

// -------------------------------------------- an element of an array
const xs: A[] = [{ n: 1 }, { n: 2 }]
;(xs[0] as B).n = 7
;(xs[1] as B).n = 8
console.log("r11", JSON.stringify(xs))

// ------------------------------------------------ a field of a record
interface Holder {
  inner: A
}
const h: Holder = { inner: { n: 1 } }
;(h.inner as B).n = 7
console.log("r12", JSON.stringify(h))

// ------------------------------------------- the value came from a call
function mk(): A {
  return { n: 1 }
}
const a13 = mk()
;(a13 as B).n = 3
console.log("r13", JSON.stringify(a13))

// ------------------------------------------------ two writes, one object
const a14: A = { n: 1 }
;(a14 as B).n = 2
;(a14 as B).n = 3
a14.n = a14.n + 1
console.log("r14", JSON.stringify(a14))

// ------------------------------- the rows that were ALREADY right
// A careless widening of the rule breaks each of these, so they are the
// control and not the subject.

// the assertion to the SAME shape is a no-op and always was
const c1: A = { n: 1 }
;(c1 as A).n = 7
console.log("r15", JSON.stringify(c1))

// a READ through the assertion answers the same value either way
const c2: A = { n: 5 }
console.log("r16", (c2 as B).n, JSON.stringify(c2))

// a CLASS instance crosses by reference and its write always landed
class K {
  n = 1
}
interface KI {
  n: number
}
const c3 = new K()
;(c3 as KI).n = 7
console.log("r17", c3.n)

// an assertion in ARGUMENT position hands the object over, not a copy
function readBack(x: B): number {
  return x.n
}
const c4: A = { n: 6 }
console.log("r18", readBack(c4 as B), JSON.stringify(c4))

// ------------------------------- the receiver runs EXACTLY ONCE
// The rule answers the operand NODE, not a lowered value, so the receiver is
// lowered once whether the rule fires or not. Answering a lowered value and
// then declining on it — which is how the dynamic sibling is written — makes
// the caller lower the receiver a second time, and `mk()` would run twice
// where Node runs it once. Both spellings, dot and bracket.
let calls = 0
function mk2(): A {
  calls = calls + 1
  return { n: 1 }
}
const box: { a: A } = { a: { n: 0 } }
function pick(): { a: A } {
  calls = calls + 1
  return box
}
;(mk2() as B).n = 7
console.log("r19", calls)
;(pick().a as B).n = 9
console.log("r20", calls, JSON.stringify(box))
;(pick().a as B)["n"] = 11
console.log("r21", calls, JSON.stringify(box))

console.log("r99 still running")
