// A `typeof v === "bigint"` narrow leaves the value DYN-TYPED, and that
// is load-bearing. This fixture exists because I broke it.
//
// maybeNarrow's dyn scalar bridge lists three kinds — f64, bool, string —
// and bridges a narrowed dyn read to a validated dynCheck at that type.
// `bigint` is absent from the list, and the absence reads exactly like
// the list-shaped bug this codebase has hit before ("immutable primitive"
// spelled as an enumeration that forgot a member): bigint IS one of the
// five typeof answers a dyn can give, the tree carries the kind
// (SCR_DYN_BIG, its own kind), and dynCheck already extracts it — the
// written cast `(u as bigint)` a few lines below proves all three.
//
// Adding `bigint` to the list compiles more programs. It also breaks this
// one. The dyn path is STRICTLY MORE CAPABLE than the static bigint path
// for at least one consumer, and JSON.stringify is that consumer:
//
//   * dyn-typed argument → the runtime dyn walker, which reaches the
//     BigInt case and throws V8's own `TypeError: Do not know how to
//     serialize a BigInt` — the ANSWER Node gives, byte for byte;
//   * bigint-typed argument → `SC1090: JSON.stringify of 'bigint' values`,
//     a COMPILE-TIME REFUSAL of a program that ran correctly before.
//
// Measured, not reasoned: with the bridge widened, the `json threw` row
// below stops being a row and becomes a build error. A trap census reads
// that as an improvement (one SC2020 in zapo's `asNumber` retires) while
// the binary reads as a regression — a correct runtime answer traded for
// a refusal. That is the census-invisible direction of the standing
// warning, and nothing on zapo's QR path touches either shape, so no QR
// sweep can see it.
//
// So the three-element list is not an oversight to tidy. Any future block
// that widens it owes an audit of every consumer that special-cases
// `kind === "dyn"` and has no bigint arm, and must route them back
// through `narrowBridgeDyn` — the idiom that already exists precisely for
// "this consumer is a test / a walker, give me the dyn underneath". These
// rows go red the moment the bridge widens without that work.
//
// UPDATE (block r17): the list WAS widened, and the price above was paid
// exactly as written. `json threw` did go red the moment the bridge
// widened, and the audit found ONE consumer — this one. JSON.stringify now
// asks for the dyn underneath through `narrowBridgeDyn`, gated on
// `jsonSafe` so it can only turn a refusal back into the dyn path and never
// moves a value the per-type serializer already handled. Every other row
// here (log / String / inspect / arr / rec / cast) kept compiling and kept
// its answer: those consumers have bigint arms of their own and print
// Node's spelling. This file is byte-identical to Node on both tiers with
// the widened bridge; corpus 3901 restates the property at its own shapes
// so the audit has a fixture on the widening side too.
//
// NO BIGINT LITERALS: they are outside the LLVM tier (SC3001), and one
// here would move the whole program to the C lane and leave the property
// unpinned in the other. 3221's rule, same reason.

import { inspect } from "node:util";

function big(n: number): bigint {
    return BigInt(n);
}

const u: unknown = big(9);

// The guard tsc honors and the bridge deliberately does not consume.
console.log("typeof:", typeof u);

if (typeof u === "bigint") {
    // Every one of these reaches a DYN path and answers correctly. Under a
    // widened bridge they would each have to find a bigint arm instead.
    console.log("log:", u);
    console.log("String:", String(u));
    console.log("inspect:", inspect(u));
    console.log("arr:", [u]);
    console.log("rec:", { v: u });

    // THE ROW. Node throws here; so does the dyn walker, with V8's message.
    // A bigint-typed argument would not reach the walker at all.
    try {
        console.log("json:", JSON.stringify(u));
    } catch (e) {
        console.log("json threw:", e instanceof TypeError, (e as Error).message);
    }

    // The extraction the bridge WOULD have built, spelled by hand. It works
    // today and is the escape hatch for anything that needs the static
    // type: `as bigint` is a validated dynCheck, so this is not a trusted
    // reinterpret — it is the same check, requested explicitly.
    console.log("cast:", (u as bigint).toString(), ((u as bigint) * big(3)).toString());
}

// The same property one level out: a bigint that reached `unknown` with no
// guard at all. Same walker, same throw — the guard is not what makes the
// dyn path work, so a widened bridge cannot be excused as "only affecting
// guarded reads".
const plain: unknown = big(4);
try {
    console.log("json plain:", JSON.stringify(plain));
} catch (e) {
    console.log("json plain threw:", e instanceof TypeError);
}

// And the control: a dyn that is NOT a bigint stringifies normally, so the
// row above is the BigInt case of the walker and not a blanket refusal.
const ok: unknown = { a: 1, b: ["x", true, null] };
console.log("json ok:", JSON.stringify(ok));

// The negative branch of the same guard, so the fixture fails loudly if a
// future change makes the test itself constant-fold.
function isBig(v: unknown): boolean {
    return typeof v === "bigint";
}
console.log("isBig:", isBig(big(1)), isBig(1), isBig("1"), isBig(null), isBig(undefined), isBig({}));
