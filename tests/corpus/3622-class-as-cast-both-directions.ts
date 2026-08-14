// `(q as R).r`, where R extends Q, raised **SC9001** on main — an internal
// compiler error, on six lines of ordinary TypeScript:
//
//   in %init.0: fieldGet receiver: expected object, got object
//                                  (expected object:R, got object:Q)
//
// lowerAsExpression ERASED a static-to-static cast, so the expression kept
// the source class. The two kinds of consumer then disagreed about what
// that meant: a consumer that COERCES fenced honestly (`const r = q as R`
// gave SC1090, "'Q' values where 'R' is expected"), while a member-access
// RECEIVER resolves its field against the CHECKER's type and never coerces
// at all — so the emitter got a base-typed pointer for a derived field's
// offset and the IR validator reported an internal error instead of a
// diagnostic. Same cast, same line, ICE on one side of it and a fence on
// the other.
//
// Both bridges already existed; neither was reachable from `as`:
//   narrowing  -> checkedDowncastBridge / %class.narrow, the instanceof-
//                 gated helper maybeNarrow builds for a narrowing tsc proved
//   widening   -> upcastTo, the prefix-layout reinterpret coerceToExpected
//                 performs for the same pair
// which makes this the union spelling (`u as Arm` -> narrowedArmHelper)
// one layer down.
//
// The WIDENING direction ICEd too — `(r as Q).q` reported "expected
// object:Q, got object:R" — and it is asserted here alongside, because the
// brief that handed this over named only the narrowing one.
//
// A LYING downcast is NOT here: Node reads `undefined` off a base instance
// and scriptc throws the catchable TypeError (divergence 38, exactly what
// the union arm bridge already does), so it cannot be a differential test.
// Both lying shapes — a plain base instance, and a SIBLING subclass, which
// is the dangerous one because it has the same width and would answer its
// own field from the same offset — are asserted in
// tests/harness/dyncheck.test.ts ("class `as` downcast: ...").

class P {
    p: string = "p"
    who(): string { return "P" }
}
class Q extends P {
    q: string = "q"
    override who(): string { return "Q" }
}
class R extends Q {
    r: string = "r"
    override who(): string { return "R" }
}
class S extends Q {
    s: string = "s"
    override who(): string { return "S" }
}

// The NARROWING direction, as a member-access receiver — the ICE itself.
const q1: Q = new R()
console.log("recv down :", (q1 as R).r)

// ...one level, which was enough on its own.
const p1: P = new Q()
console.log("recv 1lvl :", (p1 as Q).q)

// ...two levels at once, base straight to grandchild.
const p2: P = new R()
console.log("recv 2lvl :", (p2 as R).r)

// ...bound to a BINDING, which used to be the SC1090 fence. Both spellings
// of one cast now answer the same way, which is the point.
const q2: Q = new R()
const bound = q2 as R
console.log("bound down:", bound.r, bound.q, bound.p)

// ...inside a function, through a parameter.
function readR(q: Q): string { return (q as R).r }
console.log("param     :", readR(new R()))

// The WIDENING direction, both positions.
const r1: R = new R()
console.log("recv up   :", (r1 as Q).q, (r1 as P).p)
const up: P = r1 as P
console.log("bound up  :", up.p)

// A widening cast must NOT freeze dispatch: the vtable still answers the
// runtime class through a base-typed view.
console.log("virtual   :", (r1 as P).who(), (r1 as Q).who())
const sib: Q = new S()
console.log("virtual s :", (sib as P).who())

// The narrowing bridge must not disturb dispatch either.
const q3: Q = new R()
console.log("virtual d :", (q3 as R).who())

// A cast to the SAME class stays an erasure — no bridge, no check.
console.log("same      :", (r1 as R).r)

// The bridge evaluates its operand exactly ONCE.
let evals = 0
function make(): Q { evals++; return new R() }
console.log("once      :", (make() as R).r, "evals:", evals)

// A cast in a CALL-ARGUMENT position, and one feeding a field write.
function takeR(x: R): string { return x.r + x.q + x.p }
const q4: Q = new R()
console.log("arg       :", takeR(q4 as R))

class Holder { held: R = new R() }
const h = new Holder()
h.held = q4 as R
console.log("field     :", h.held.r)

// Casts chained through each other.
const p3: P = new R()
console.log("chained   :", ((p3 as Q) as R).r)

// An array element and an ARRAY of the base read back narrowed.
const list: Q[] = [new R(), new R()]
console.log("elem      :", (list[0] as R).r, (list[1] as R).r)

// The cast inside a conditional the checker already narrowed — the
// instanceof-proven path must still agree with the asserted one.
const maybe: Q = new R()
if (maybe instanceof R) {
    console.log("narrowed  :", maybe.r, (maybe as R).r)
}

// Identity survives the round trip: no copy is made in either direction.
const ident: Q = new R()
console.log("identity  :", (ident as R) === ident, ((ident as R) as Q) === ident)
