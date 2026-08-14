// Two more raw call-side guards, and neither is a fence story.
//
// `n.toString?.(16)` — lowerPrimitiveProtoCall. The receiver is a NUMBER,
// so the callee `n.toString` is a bound method on a primitive box, which
// this compiler deliberately does not materialize as a value ("number
// methods as values (call 'toString' directly)"). The guarded call never
// wanted the value; it wanted the radix conversion.
//
// `isErr?.(e)` on a CATCH BINDING — lowerCaughtPredicateCall. This one
// already produced the right answer on both sides, and that is exactly
// why it is here: on base it produced it by the WRONG ROUTE. The guard
// declined, the generic call path took over, and the caught snapshot was
// boxed into a dyn node to cross the call boundary — the emitted C carries
// a `caught -> unknown` converter and a real call to the predicate. With
// the guard converted the predicate INLINES at the call site with the
// parameter aliased to the caught local, which is the whole point of the
// lowering ("the caught snapshot cannot cross a call boundary"). Same
// values, one fewer boundary.

// ── primitive-box methods through the optional call ────────────────────
const n = 255;
console.log("radix 16:", n.toString?.(16));
console.log("radix 2:", n.toString?.(2));
console.log("plain:", n.toString?.());
console.log("agrees:", n.toString?.(16) === n.toString(16));

const f = 1.5;
console.log("float:", f.toString?.(), "bool:", true.toString?.());

const s = "abcdef";
console.log("charAt:", s.charAt?.(2), "own length:", s.hasOwnProperty?.("length"));
console.log("own index:", s.hasOwnProperty?.("2"), s.hasOwnProperty?.("99"));
console.log("number owns nothing:", n.hasOwnProperty?.("length"));

// Arguments evaluate exactly once for a never-nullish callee.
let evals: string[] = [];
function arg<T>(tag: string, v: T): T {
    evals.push(tag);
    return v;
}
function shown(): string {
    const t = evals.join(",");
    evals = [];
    return t === "" ? "(none)" : t;
}
console.log("radix arg once:", n.toString?.(arg("r", 8)), shown());

// ── a type guard called on a catch binding ─────────────────────────────
function isErr(x: unknown): x is Error {
    return x instanceof Error;
}
function isRange(x: unknown): x is RangeError {
    return x instanceof RangeError;
}

try {
    throw new Error("boom");
} catch (e) {
    console.log("guarded:", isErr?.(e) ? "error" : "other");
    if (isErr?.(e)) console.log("message:", e.message);
    console.log("not a range error:", isRange?.(e));
}

try {
    throw new RangeError("out of range");
} catch (e) {
    console.log("range:", isRange?.(e), "also error:", isErr?.(e));
    if (isRange?.(e)) console.log("range message:", e.message);
}

// A thrown non-Error still answers, and still answers false.
try {
    throw "a string";
} catch (e) {
    console.log("string throw:", isErr?.(e), typeof e === "string");
}

// ── the short-circuit half, on a genuinely nullish predicate ───────────
type Guard = ((x: unknown) => boolean) | undefined;
function guard(on: boolean): Guard {
    return on ? (x: unknown): boolean => x instanceof Error : undefined;
}
const live: Guard = guard(true);
const gone: Guard = guard(false);

try {
    throw new Error("second");
} catch (e) {
    console.log("live guard:", live?.(arg("l", e)), shown());
    console.log("gone guard:", gone?.(arg("g", e)), shown());
    console.log("gone is undefined:", gone?.(arg("g2", e)) === undefined, shown());
    console.log("coalesced:", (gone?.(arg("g3", e)) ?? false) === false, shown());
}
