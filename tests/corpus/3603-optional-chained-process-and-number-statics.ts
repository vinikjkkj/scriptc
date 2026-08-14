// Three more raw `questionDotToken` guards on the property side, plus the
// shared helper that hid one of them:
//
//   process.env?.NAME       lowerProcessEnvGet
//   process.stdout?.isTTY   lowerProcessStreamProperty
//   Number?.isInteger       numberStaticPredicateFnValueOf
//
// The Number lift needed a second edit to be reachable at all. Its own
// guard is only half the gate: `stdlibGlobalMember` — the shared
// `<global>.<member>` resolver every stdlib property lowering asks —
// carried its own raw token test one level down, invisible to a census of
// function-opening guards. With the lowering's guard converted and the
// resolver's left raw, `Number?.isInteger` still fenced.
//
// `Number` is the one stdlib global that lowers as a chain RECEIVER; Math,
// JSON, Error, Uint8Array, console, process and globalThis all refuse
// there, so their member guards can never be consulted and stay raw.
//
// process.env is the entry worth pinning for a reason that is not a fence:
// the chained spelling already produced the right VALUE, through the
// whole-object snapshot path (environ materialized as an array of pairs
// and searched) instead of the single getenv(3) the plain spelling
// lowers. A right answer by an accidental route is exactly what a guard
// conversion is supposed to retire.

// ── process.env ────────────────────────────────────────────────────────
const absent = process.env?.SCRIPTC_NO_SUCH_VAR_3603;
console.log("absent is undefined:", absent === undefined);
console.log("absent:", absent);

// A variable the program sets itself, so the value is the program's and
// not the host's.
process.env.SCRIPTC_PROBE_3603 = "set-by-the-program";
console.log("present:", process.env?.SCRIPTC_PROBE_3603);
console.log("agrees with plain:", process.env?.SCRIPTC_PROBE_3603 === process.env.SCRIPTC_PROBE_3603);

// The read is live, not a snapshot taken at the first chained access.
process.env.SCRIPTC_PROBE_3603 = "rewritten";
console.log("after rewrite:", process.env?.SCRIPTC_PROBE_3603);

// ── process.stdout.isTTY ───────────────────────────────────────────────
// Node exposes `undefined` on a non-TTY stream where this compiler answers
// a real boolean (the documented divergence), so the TRUTHINESS is the
// comparable observation — which is the actual usage, and agrees.
console.log("isTTY truthy:", Boolean(process.stdout?.isTTY));
console.log("stderr isTTY truthy:", Boolean(process.stderr?.isTTY));
console.log("agrees with plain:", Boolean(process.stdout?.isTTY) === Boolean(process.stdout.isTTY));

// ── Number statics ─────────────────────────────────────────────────────
console.log("max safe:", Number?.MAX_SAFE_INTEGER);
console.log("min safe:", Number?.MIN_SAFE_INTEGER);
console.log("epsilon positive:", (Number?.EPSILON) > 0);
console.log("agrees with plain:", Number?.MAX_SAFE_INTEGER === Number.MAX_SAFE_INTEGER);

// The predicate members lift to closures; the read is the VALUE form, and
// the closure has to answer exactly what the call form does.
const isInt = Number?.isInteger;
const isFin = Number?.isFinite;
const isNan = Number?.isNaN;
console.log("isInteger:", isInt(3), isInt(3.5), isInt(NaN));
console.log("isFinite:", isFin(1), isFin(Infinity), isFin(NaN));
console.log("isNaN:", isNan(NaN), isNan(0));
console.log("agrees with the call form:", isInt(7) === Number.isInteger(7), isFin(7) === Number.isFinite(7));

// Passed on as a value: the lift is an ordinary closure.
function count(xs: number[], p: (v: number) => boolean): number {
    let n = 0;
    for (const x of xs) {
        if (p(x)) n = n + 1;
    }
    return n;
}
console.log("ints among:", count([1, 1.5, 2, 2.5, 3], isInt));
