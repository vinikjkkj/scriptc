// `a.length op= e` — the COMPOUND spelling of the array-length store.
//
// The plain form `a.length = n` has been lowered for a long time (the
// `arrIntrinsic setLength` path lower-stmts claims before any field path
// runs). The compound form had no such claim: `length` is not a declared
// FIELD of anything, so `fieldTarget` answered null and the compound field
// path refused it with SC1090 "compound assignment to unsupported field
// targets". zapo-js 1.8.2's `util/proto-stream.ts:256` writes
// `stack.length -= 1` to pop a descent frame, and that is the spelling
// that found the gap.
//
// What this pins against Node:
//
//  - ALL TWELVE arithmetic/bitwise compound operators reach `length`
//    (`+= -= *= /= %= **= <<= >>= >>>= &= |= ^=`), plus `++`/`--` in both
//    fixities. The bitwise five run ToInt32/ToUint32 on the length before
//    they combine, which is where `9 >>> 1` and `5 ^ 3` earn their place.
//    The three LOGICAL assignments (`&&= ||= ??=`) are refused at compile
//    time with their own messages and are not here.
//  - The RECEIVER is evaluated EXACTLY ONCE. `getStack().length -= 1` is
//    one call in JS — the MemberExpression becomes a Reference, the
//    Reference is read, and the SAME Reference is written — and the
//    counter below is what proves it, on a receiver whose evaluation has
//    an observable side effect.
//  - The READ happens BEFORE the right-hand side runs, so an RHS that
//    pushes onto the same array does not change the length the operator
//    subtracts from.
//  - Value position yields what JS yields: the compound assignment answers
//    the NEW length, postfix `++` the old one, prefix the new.
//  - A result that is negative or fractional is a RangeError("Invalid
//    array length") thrown BEFORE anything moves — the array still holds
//    every element it held.
//
// Growth is covered in 7787 together with the element kinds that cannot
// represent a hole; here every array holds records, which can.

interface Frame { readonly n: number }

function mk(n: number): Frame[] {
    const a: Frame[] = []
    for (let i = 0; i < n; i++) a.push({ n: i })
    return a
}

// Reads only the slots the caller declares still occupied: a GROWN slot is
// a hole, and reading one is the documented dense-array divergence (Node
// answers undefined, scriptc traps with the index and the length).
function dump(tag: string, a: Frame[], live: number): void {
    const parts: string[] = []
    for (let i = 0; i < live; i++) parts.push(String(a[i].n))
    console.log(tag, a.length, parts.join(","))
}

// ── the twelve operators ─────────────────────────────────────────────────
const a1 = mk(6); a1.length -= 1; dump("minus", a1, a1.length)
const a2 = mk(2); a2.length += 2; dump("plus", a2, 2)
const a3 = mk(3); a3.length *= 2; dump("times", a3, 3)
const a4 = mk(6); a4.length /= 2; dump("div", a4, a4.length)
const a5 = mk(7); a5.length %= 4; dump("mod", a5, a5.length)
const a6 = mk(3); a6.length **= 2; dump("pow", a6, 3)
const a7 = mk(2); a7.length <<= 2; dump("shl", a7, 2)
const a8 = mk(9); a8.length >>= 1; dump("shr", a8, a8.length)
const a9 = mk(9); a9.length >>>= 1; dump("ushr", a9, a9.length)
const a10 = mk(6); a10.length &= 3; dump("and", a10, a10.length)
const a11 = mk(4); a11.length |= 3; dump("or", a11, 4)
const a12 = mk(5); a12.length ^= 3; dump("xor", a12, 5)

// ── ++ / -- as statements, both fixities ─────────────────────────────────
const b1 = mk(3); b1.length++; dump("inc", b1, 3)
const b2 = mk(3); b2.length--; dump("dec", b2, b2.length)
const b3 = mk(3); ++b3.length; dump("preinc", b3, 3)
const b4 = mk(3); --b4.length; dump("predec", b4, b4.length)

// ── value position ───────────────────────────────────────────────────────
const c1 = mk(4)
console.log("val-compound", c1.length -= 1, c1.length)
const c2 = mk(4)
console.log("val-post", c2.length++, c2.length)
const c3 = mk(4)
console.log("val-pre", ++c3.length, c3.length)
const c4 = mk(4)
console.log("val-postdec", c4.length--, c4.length)

// ── ONE evaluation of a side-effecting receiver ──────────────────────────
let calls = 0
const held = mk(5)
function getStack(): Frame[] { calls++; return held }
getStack().length -= 2
console.log("calls", calls, "len", held.length)
calls = 0
getStack().length += 1
console.log("calls", calls, "len", held.length)
calls = 0
console.log("calls-value", (getStack().length -= 1), calls, held.length)

// ── the read precedes the right-hand side ────────────────────────────────
const d = mk(3)
d.length -= (d.push({ n: 99 }), 1)
dump("rhs-mutates", d, d.length)

// ── a shrink RELEASES the tail, and the array is reusable after it ───────
const g = mk(4)
g.length -= 2
dump("shrunk", g, g.length)
g.push({ n: 42 })
dump("regrown", g, g.length)

// ── RangeError, thrown with the array untouched ──────────────────────────
const f1 = mk(2)
try { f1.length -= 5 } catch (err) { console.log("neg", (err as Error).name, (err as Error).message) }
dump("after-neg", f1, f1.length)
const f2 = mk(3)
try { f2.length /= 2 } catch (err) { console.log("frac", (err as Error).name, (err as Error).message) }
dump("after-frac", f2, f2.length)
const f3 = mk(1)
try { f3.length -= 1; f3.length-- } catch (err) { console.log("under", (err as Error).name, (err as Error).message) }
console.log("after-under", f3.length)

// ── one compound in the VALUE position of another ────────────────────────
// The outer receiver's reference resolves first, then the outer read, then
// the inner assignment as the outer's right-hand side.
const n1 = mk(4)
const n2 = mk(3)
n1.length -= (n2.length -= 1)
console.log("nested", n1.length, n2.length)

// ── the same store through the plain spelling, for the pair ──────────────
const h = mk(3)
try { h.length = -2 } catch (err) { console.log("plain-neg", (err as Error).name, (err as Error).message) }
dump("after-plain-neg", h, h.length)
