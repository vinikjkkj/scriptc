// The PROOF direction of the never-nullish re-dispatch, pinned against
// effects rather than values.
//
// The gate that opens a `?.` link on a receiver with no standalone value
// asks the checker whether that receiver can be nullish, and re-dispatches
// the plain lowering when it cannot. A wrong `true` there would not answer
// a wrong value — it would stop declining and start EVALUATING what `?.`
// is supposed to skip, which no value comparison can see. So every arm the
// gate could have swallowed is exercised here with a counter beside it: a
// nullable union receiver, a TAIL chain, an element access, a checked-
// dynamic receiver, and an optional CALL. Each one short-circuits, each
// one evaluates its receiver exactly once and its arguments not at all,
// and each one answers undefined.
//
// The gate excludes `any` and `unknown` deliberately — their values exist
// as island handles and checked-dynamic nodes, and the chain's own arms
// answer them — so the dyn section below is the regression test for that
// exclusion, not a bonus.

let effects = 0;
function boom(tag: string): string {
    effects = effects + 1;
    return tag;
}

// ── a nullable union receiver: member skipped, argument skipped ───────
function maybeText(on: boolean): string | undefined {
    return on ? "abcabc" : undefined;
}
console.log("present:", maybeText(true)?.indexOf(boom("b")));
console.log("effects:", effects);
console.log("absent:", maybeText(false)?.indexOf(boom("b")));
console.log("effects:", effects);
console.log("absent is undefined:", maybeText(false)?.slice(boom("1").length) === undefined);
console.log("effects:", effects);

// ── the receiver is evaluated exactly ONCE, present or absent ─────────
let recvEvals = 0;
function pick(on: boolean): string | undefined {
    recvEvals = recvEvals + 1;
    return on ? "xyz" : undefined;
}
console.log("present len:", pick(true)?.length, "recv evals:", recvEvals);
console.log("absent len:", pick(false)?.length, "recv evals:", recvEvals);

// ── a TAIL chain: the WHOLE tail short-circuits with the guard ────────
// `x?.trim().toUpperCase()` reads nothing at all when x is nullish, and
// the intermediate step must not be evaluated either.
function maybePadded(on: boolean): string | undefined {
    return on ? "  hi  " : undefined;
}
console.log("tail present:", maybePadded(true)?.trim().toUpperCase());
console.log("tail absent:", maybePadded(false)?.trim().toUpperCase());
console.log("tail absent is undefined:", maybePadded(false)?.trim().toUpperCase() === undefined);

// ── an ELEMENT access through the link ────────────────────────────────
function maybeRow(on: boolean): number[] | undefined {
    return on ? [10, 20, 30] : undefined;
}
console.log("elem present:", maybeRow(true)?.[1]);
console.log("elem absent:", maybeRow(false)?.[1]);
console.log("elem absent is undefined:", maybeRow(false)?.[1] === undefined);

// ── an optional CALL on a nullable callee: arguments not evaluated ────
function maybeFn(on: boolean): ((s: string) => string) | undefined {
    return on ? (s: string) => "got:" + s : undefined;
}
console.log("call present:", maybeFn(true)?.(boom("c")));
console.log("effects:", effects);
console.log("call absent:", maybeFn(false)?.(boom("c")));
console.log("effects:", effects);

// ── the CHECKED-DYNAMIC receiver, which the gate must not claim ───────
// A JSON.parse result is `any`; its optional reads answer undefined
// directly and its optional method calls dispatch at runtime. The gate
// answers FALSE for `any`, so this whole section rides the pre-existing
// path unchanged.
const parsed = JSON.parse('{"name":"pkg","nested":{"deep":7},"list":[1,2,3]}');
console.log("dyn name:", parsed?.name);
console.log("dyn deep:", parsed?.nested?.deep);
console.log("dyn missing:", parsed?.nope);
console.log("dyn missing is undefined:", parsed?.nope === undefined);
console.log("dyn nested missing:", parsed?.nope?.deeper);
console.log("dyn index:", parsed?.list?.[2]);
const empty = JSON.parse("null");
console.log("dyn null receiver:", empty?.anything);

// ── a never-nullish receiver in the same program, for contrast ────────
// These take the re-dispatch. Their arguments evaluate exactly ONCE —
// not zero times (the guard is not a short-circuit here) and not twice
// (the discarded receiver lowering must not duplicate them).
let argEvals = 0;
function tick(v: number): number {
    argEvals = argEvals + 1;
    return v;
}
console.log("floor:", Math?.floor(tick(4.9)));
console.log("arg evals:", argEvals);
console.log("max:", Math?.max(tick(2), tick(8)));
console.log("arg evals:", argEvals);
console.log("keys:", Object?.keys({ p: 1, q: 2 }).join(","));
console.log("arg evals:", argEvals);

// The two spellings agree, which is the whole claim of the re-dispatch.
console.log("agrees:", Math?.floor(4.9) === Math.floor(4.9));
console.log("effects total:", effects, "recv evals total:", recvEvals, "arg evals total:", argEvals);
