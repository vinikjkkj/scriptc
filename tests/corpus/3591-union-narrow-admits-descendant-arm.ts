// A union narrowing that lands on a CLASS arm must admit that arm's
// DESCENDANTS, because a subclass value in a base-class position is what
// tsc's assignability admits and what this runtime's layout supports.
//
// `narrowedArmHelper` — the `%union.narrow.<n>(u)` machinery behind `x!`
// and behind coerceToExpected's checked single-arm extraction — used to
// throw for every arm but the exact one. That made the sound program
//
//     const arr: (P | Q)[] = [new Q()];
//     const p: P = arr[0]!;
//
// throw an UNCODED `TypeError: a 'Q' value is not representable in the
// target union`, at run time, on both backends, where Node prints the
// value. Nothing narrowed wrongly and nothing lied: `Q extends P`, so the
// `Q` arm satisfies a claim of `P` outright.
//
// The compiler already had the rule written down — `admissibleArmTags`:
// "the arm itself, plus — when the arm is a CLASS — every arm that
// strictly descends from it", justified by the payload being
// prefix-compatible and carrying its own vtable. `checkedArmHelper`
// consulted it; `narrowedArmHelper` did not, and the two `x!` paths and
// coerceToExpected all reach the latter directly. This fixture pins the
// rule at the helper every one of them shares.
//
// The extraction the helper falls through to is a tag-independent payload
// peek, so admitting the descendant tag needs no new code on the value
// path — the same pointer comes out, and `who()` below proves the vtable
// came with it.
//
// RECORDS are deliberately NOT widened the same way and this fixture does
// not ask them to be: two record shapes put different fields at the same
// offsets, so a wider record in a narrower record's slot is exactly the
// confusion the check exists to catch, and the only sound bridge is a
// COPY, which is observable. That case still traps, on purpose.

class P {
    p = 1;
    who(): string {
        return "P";
    }
}

class Q extends P {
    q = 2;
    who(): string {
        return "Q";
    }
}

class R extends Q {
    r = 3;
    who(): string {
        return "R";
    }
}

// A standalone class in the same union: NOT a descendant, so a claim of
// `P` must still refuse it. It is never the value that flows to a `P`
// slot below — it is here so the union carries an inadmissible arm and
// the helper keeps a real test rather than becoming unconditional.
class Other {
    o = 9;
}

// The `x!` path: the element read is `P | Q | R | undefined`, and the
// non-null assertion extracts through the same helper.
const mixed: (P | Q | R)[] = [new P(), new Q(), new R()];
const viaBang: string[] = [];
for (let i = 0; i < mixed.length; i++) {
    const base: P = mixed[i]!;
    viaBang.push(`${base.who()}:${base.p}`);
}
console.log("bang", viaBang.join(","));

// The coerceToExpected path: a for-of binding whose declared type is the
// base class, fed from the union element type.
const viaAssign: string[] = [];
for (const e of mixed) {
    const base: P = e;
    viaAssign.push(base.who());
}
console.log("assign", viaAssign.join(","));

// A narrowing to an INTERMEDIATE class: `R` descends from `Q`, `P` does
// not, so the admissible set is a strict subset of the arms.
const qOrR: (Q | R)[] = [new Q(), new R()];
const mid: string[] = [];
for (const e of qOrR) {
    const q: Q = e;
    mid.push(`${q.who()}/${q.q}`);
}
console.log("mid", mid.join(","));

// The inadmissible arm still refuses, and the refusal is catchable.
function claimP(v: P | Other): string {
    // `as` past the checker: the value really is an `Other`, so this is a
    // lying assertion and the helper is right to throw.
    const p = v as P;
    return `${p.who()}`;
}
try {
    console.log("other", claimP(new Other()));
} catch (e) {
    console.log("other threw", e instanceof TypeError);
}

// The honest direction still works through the same helper.
console.log("ok", claimP(new R()));

// Fields declared on the descendant survive the round trip: the value in
// the base-typed slot is the same object, not a copy. Mutating through
// the narrowed binding is visible through the array, which is the whole
// difference between admitting the arm and width-lifting a record.
//
// (`P` is not an ARM of `Q | R`, only a common ancestor of both, so
// `const p: P = qOrR[1]!` is a compile-time SC2003 rather than anything
// this fixture can assert at run time. That fence is unrelated and
// unchanged — the admissible set widens which arms a claim ACCEPTS, not
// which types a union re-tags into.)
const held: Q = qOrR[1]!;
held.q = 42;
console.log("identity", qOrR[1]!.q, held.who());
