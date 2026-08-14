// THREE non-unit arms, which is the shape that exercises the CHAIN in both
// emitters rather than the single unconditional re-tag.
//
// The chain has no invalid-tag case on purpose: the unit tags are consumed
// by the nullish test above it, so the LAST non-unit arm is the fallthrough.
// If that reasoning were wrong, one of the five lines below would answer as
// another arm — a scalar read out of a record box, or the reverse — rather
// than merely trapping. Both backends run it.

interface A {
    a: number;
}
interface B {
    b: string;
}

let defaults = 0;
function fallback(): boolean {
    defaults += 1;
    return true;
}

function pick(x: number | A | B | null | undefined): number | A | B | boolean {
    return x ?? fallback();
}

console.log(JSON.stringify(pick(5)), defaults);
console.log(JSON.stringify(pick({ a: 1 })), defaults);
console.log(JSON.stringify(pick({ b: "z" })), defaults);
console.log(JSON.stringify(pick(null)), defaults);
console.log(JSON.stringify(pick(undefined)), defaults);

// Four non-unit arms with a REF arm last, so the fallthrough case is the one
// that has to move ownership rather than copy a scalar. The loop makes a
// leaked box visible to SCRIPTC_RC_AUDIT=1.
function pick4(x: number | boolean | A | string[] | null): number | boolean | A | string[] | "d" {
    return x ?? "d";
}
let last = "";
for (let i = 0; i < 200; i += 1) {
    const which = i % 5;
    const v: number | boolean | A | string[] | null =
        which === 0 ? 1 : which === 1 ? false : which === 2 ? { a: i } : which === 3 ? ["e"] : null;
    last = JSON.stringify(pick4(v));
}
console.log(last, JSON.stringify(pick4(["k"])), JSON.stringify(pick4(null)));
