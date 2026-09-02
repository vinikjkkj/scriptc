// TAKING THE HINT HAS TO WORK. The three key-order refusals each end with
// "read the fields you need instead of enumerating, or build the value the
// way the shape enumerates it", and a diagnostic's suggested rewrite is a
// claim about semantics that has to be checked against the oracle rather
// than assumed. This program is the three refused constructions with the
// hint TAKEN, and it must match Node byte for byte - if it ever stops
// matching, the compiler is telling people to write a program that is still
// wrong, which is worse than the refusal it replaced.
//
// The refused originals live in
// tests/diagnostics/key-order-through-a-spread-a-return-and-a-filled-record.ts.
//
// EACH CASE USES ITS OWN KEY NAMES, and that is not tidiness. The first draft
// spelled all three over {a, b, c} and the SPREAD case refused even after the
// rewrite: `interface Three { a; b; c }` interns the shape first, so the
// literal `{ ...base, c: 3 }` - which really does enumerate b,a,c, and which
// Node agrees with - inherited a declaredOrder that is not its own. Taking
// the hint is therefore not always possible by reordering the literal alone:
// declaredOrder belongs to whichever type reached the shape first, and no
// spelling of a second literal can change it. That is an argument for
// carrying the order per instance, and it is recorded here because the
// oracle found it and reasoning did not.

// 1. `{ c: 3, ...base }` refuses; the spelled key moves AFTER the spread.
const sbase = { sb: 1, sa: 2 };
const spread = { ...sbase, sc: 3 };
console.log("spread-keys=" + Object.keys(spread).join(","));
console.log("spread-json=" + JSON.stringify(spread));

// 2. A function returning `{ c, a, b }` refuses; the literal is spelled the
// way the shape enumerates.
interface Three {
    ra: number;
    rb: number;
    rc: number;
}
function mk(): Three {
    return { ra: 1, rb: 2, rc: 3 };
}
console.log("return-json=" + JSON.stringify(mk()));
console.log("return-keys=" + Object.keys(mk()).join(","));

// 3. `r.b = 1; r.a = 2` refuses; the writes go in declared order.
interface Pair {
    wa?: number;
    wb?: number;
}
const filled: Pair = {};
filled.wa = 2;
filled.wb = 1;
console.log("write-entries=" + Object.entries(filled).map((e) => e[0]).join(";"));
console.log("write-keys=" + Object.keys(filled).join(","));
