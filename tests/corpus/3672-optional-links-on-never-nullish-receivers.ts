// The receivers a `?.` link could never reach, in TypeScript. `Math?.floor`,
// `Error?.prototype`, `performance?.now()`, `path?.join(...)`,
// `console?.log(...)`, `new Date(0)?.toISOString()` and
// `new Intl.NumberFormat("en-US")?.format(x)` all failed to COMPILE, each
// naming its own receiver — 'Math', 'Error', 'performance', "module
// namespace objects as values", 'console', 'new Date', "constructing values
// other than classes declared in the program" — while the plain spelling
// of every one of them lowers.
//
// The cause was never the guard inside the lowering. `lowerOptionalChain`
// opened by lowering the guarded receiver as a STANDALONE value, and none
// of these receivers has one: a namespace object, a builtin global, a
// `new` instance. The chain refused before the lowering behind it was
// consulted, so three successive censuses classified those guards
// "unreachable, correct as they stand" — correctly, and for a reason one
// level up from where they were looking.
//
// When the checker proves the receiver neither null nor undefined, `?.` IS
// `.`: no short-circuit can happen and the chain's value is the plain
// form's, so there is no reason to demand a value for a receiver nobody
// consumes. Each line below is pinned against its own plain spelling, and
// the short-circuit — which none of these receivers can exercise, because
// none of them is nullable — is pinned separately at the bottom.

import * as path from "node:path";

// ── globals whose members lower, through the optional link ────────────
console.log("floor:", Math?.floor(3.7), "agrees:", Math?.floor(3.7) === Math.floor(3.7));
console.log("max:", Math?.max(1, 9, 4), "abs:", Math?.abs(-2));

// The function VALUE, not the call — a different lowering from the call
// form, and the one that stayed fenced after the call form opened.
const floorFn = Math?.floor;
console.log("floor as a value:", floorFn(9.9));

console.log("proto is an object:", typeof Error?.prototype === "object");
console.log("u8 proto is an object:", typeof Uint8Array?.prototype === "object");

const fromU8 = Uint8Array?.from([1, 2, 3]);
console.log("Uint8Array.from:", fromU8.length, fromU8[2]);

console.log("MAX_SAFE_INTEGER:", Number?.MAX_SAFE_INTEGER);
console.log("isInteger:", Number?.isInteger(4), Number?.isInteger(4.5));

// ── Object/Array/Symbol/RegExp/Buffer/Date statics in TypeScript ──────
const o: Record<string, number> = { a: 1, b: 2 };
console.log("keys:", Object?.keys(o).join(","));
console.log("values:", Object?.values(o).join(","));
const maybeArr: unknown = [1, 2];
console.log("isArray:", Array?.isArray(maybeArr));
console.log("from mapped:", Array?.from({ length: 3 }, (_, i: number) => i * 2).join(","));
console.log("escape:", RegExp?.escape("a.b"));
const sym = Symbol?.for("scriptc.ts.tag");
console.log("keyFor:", Symbol?.keyFor(sym));
console.log("buffer:", Buffer?.from("hi").toString("hex"));

// ── a `new` expression as the receiver ────────────────────────────────
console.log("iso:", new Date(0)?.toISOString());
console.log("iso agrees:", new Date(0)?.toISOString() === new Date(0).toISOString());
console.log("nf:", new Intl.NumberFormat("en-US")?.format(1234.5));

// ── a module NAMESPACE object as the receiver ─────────────────────────
console.log("join:", path?.join("a", "b") === path.join("a", "b"));
console.log("basename:", path?.basename("/x/y/z.txt"));
console.log("extname:", path?.extname("z.txt"));

// ── `process` and `performance`, the two runtime globals ──────────────
console.log("platform is non-empty:", process?.platform.length > 0);
console.log("pid is positive:", process?.pid > 0);
const now = performance?.now();
console.log("performance.now is a number >= 0:", now >= 0);

// ── `console` itself through the link ─────────────────────────────────
console?.log("console through the link");
console?.error("stderr through the link");

// ── Date.now ──────────────────────────────────────────────────────────
console.log("date.now is a recent epoch:", Date?.now() > 1600000000000);

// ── THE ARGUMENT RULE, pinned against an EFFECT ───────────────────────
// A never-nullish receiver runs the member, so its arguments evaluate
// exactly once. A re-dispatch that lowered the argument twice, or a fold
// that dropped the guard AND the argument, would both show here.
let argEvals = 0;
function tick(v: number): number {
    argEvals = argEvals + 1;
    return v;
}
console.log("floor of an effectful arg:", Math?.floor(tick(7.9)));
console.log("arg evals:", argEvals);
console.log("max of two effectful args:", Math?.max(tick(1), tick(5)));
console.log("arg evals:", argEvals);

// ── THE SHORT-CIRCUIT, which no receiver above can exercise ───────────
// Every receiver above is proven non-nullish, so `?.` never short-circuits
// there and the gate that re-dispatches them must never claim a receiver
// that CAN be nullish. A genuinely nullable one has to evaluate neither
// the member nor its arguments, and answer undefined.
let skipped = 0;
function boom(): string {
    skipped = skipped + 1;
    return "b";
}
function maybeText(on: boolean): string | undefined {
    return on ? "abc" : undefined;
}
console.log("present:", maybeText(true)?.indexOf(boom()));
console.log("evals after present:", skipped);
console.log("absent:", maybeText(false)?.indexOf(boom()));
console.log("evals after absent:", skipped);
console.log("absent is undefined:", maybeText(false)?.indexOf(boom()) === undefined);
console.log("evals after absent again:", skipped);

// The receiver of a nullable chain is evaluated exactly ONCE, present or
// absent — the guard short-circuits the member, never the receiver.
let recvEvals = 0;
function pick(on: boolean): string | undefined {
    recvEvals = recvEvals + 1;
    return on ? "xyz" : undefined;
}
console.log("present len:", pick(true)?.length, "recv evals:", recvEvals);
console.log("absent len:", pick(false)?.length, "recv evals:", recvEvals);
