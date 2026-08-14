// `X.m?.(args)` — the DEFENSIVE OPTIONAL CALL, on stdlib statics.
//
// The token here sits on the CALL, not on a member access: `?.` asks
// whether the CALLEE is nullish, not the receiver. Thirteen call lowerings
// opened with a raw `if (call.questionDotToken) return null;` and every one
// of them was dead behind a fence one step earlier — the chain machinery
// opened by lowering the callee as a STANDALONE function value, and
// `JSON.stringify` as a value, `Promise.all` as a value and `n.toString` as
// a value are each their own deliberate refusal. So the diagnostic named
// the callee ("JSON methods as values (call 'stringify' directly)") for a
// program that never wanted the value, only the call.
//
// A callee the checker proves non-nullish cannot short-circuit, so `?.` IS
// `.` and the value is the plain call's. What has to stay true either way
// is the ARGUMENT rule, and it cuts both ways — which is why both halves
// are pinned below:
//
//   * a never-nullish callee evaluates its arguments exactly once, in
//     order, like any call;
//   * a genuinely nullish callee evaluates NONE of them, and answers
//     undefined.
//
// The second half is the one a lost guard breaks silently: an argument
// with a side effect would start running for a call that never happens.

let evals: string[] = [];
function arg<T>(tag: string, v: T): T {
    evals.push(tag);
    return v;
}
function shown(): string {
    const s = evals.join(",");
    evals = [];
    return s === "" ? "(none)" : s;
}

// ── JSON, the generic-method-as-value fence's own member ───────────────
console.log("json:", JSON.stringify?.({ a: 1, b: [2, 3] }));
console.log("json arg once:", JSON.stringify?.(arg("j", { a: 1 })), shown());
console.log("json parse:", JSON.stringify?.(JSON.parse?.('{"n":5}')));

// ── the Number predicate statics ───────────────────────────────────────
console.log("isInteger:", Number.isInteger?.(1), Number.isInteger?.(1.5));
console.log("isFinite:", Number.isFinite?.(1 / 0), Number.isSafeInteger?.(9007199254740993));
console.log("isNaN:", Number.isNaN?.(Number.NaN), Number.isNaN?.(0));
console.log("agrees:", Number.isInteger?.(7) === Number.isInteger(7));

// ── String statics ─────────────────────────────────────────────────────
console.log("fromCharCode:", String.fromCharCode?.(72, 105));
console.log("fromCodePoint:", String.fromCodePoint?.(0x1f600).length);
console.log("charcode arg once:", String.fromCharCode?.(arg("c", 65)), shown());

// ── process methods ────────────────────────────────────────────────────
const cwd = process.cwd?.();
console.log("cwd is a string:", cwd.length > 0, "stable:", process.cwd?.() === cwd);

// ── Promise statics: resolve, reject, and the homogeneous-tuple all ────
async function one(): Promise<number> {
    return 1;
}
async function two(): Promise<number> {
    return 2;
}
const resolved: Promise<number> = Promise.resolve?.(41) as Promise<number>;
console.log("resolved:", await resolved);

const pair = await (Promise.all?.([one(), two()]) as Promise<number[]>);
console.log("all tuple:", pair[0], pair[1], pair.length);

async function rejects(): Promise<number> {
    return Promise.reject?.(new Error("nope")) as Promise<number>;
}
try {
    await rejects();
    console.log("unreachable");
} catch (e) {
    console.log("rejected:", (e as Error).message);
}

// ── Reflect.apply over a rest-parameter builtin ────────────────────────
import * as path from "node:path";
console.log("reflect apply:", Reflect.apply?.(path.join, null, ["a", "b", "c"]));

// ── THE SHORT-CIRCUIT, which the conversion must not lose ──────────────
// A callee that really is `(() => number) | undefined`. The absent arm
// must answer undefined AND evaluate none of the arguments.
type Maybe = ((n: number) => number) | undefined;
function pick(on: boolean): Maybe {
    return on ? (n: number): number => n * 2 : undefined;
}

console.log("present:", pick(true)?.(arg("p", 21)), shown());
console.log("absent:", pick(false)?.(arg("a", 21)), shown());
console.log("absent is undefined:", pick(false)?.(arg("a2", 1)) === undefined, shown());

// The same through a BINDING rather than a call, both arms.
const live: Maybe = pick(true);
const gone: Maybe = pick(false);
console.log("live:", live?.(arg("l", 5)), shown());
console.log("gone:", gone?.(arg("g", 5)), shown());

// A nullish callee inside an expression whose other half still runs: the
// guard short-circuits the CALL, not the statement.
console.log("coalesced:", gone?.(arg("x", 1)) ?? -1, shown());
console.log("live coalesced:", live?.(arg("y", 3)) ?? -1, shown());
