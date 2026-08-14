// The ten stdlib-static call lowerings whose raw `?.` guard was reachable
// only in a JAVASCRIPT source. `Object?.keys(o)` in a .cjs COMPILES and
// then throws at runtime — "'Object.keys' ... has no scriptc lowering yet
// [SC2020]" — while `Object.keys(o)` on the line above it lowers. The
// difference is the source kind, not the receiver: a TypeScript source
// fences on `Object` itself (SC2020 'Object', a compile error), so the
// chain never reaches the lowering behind the guard and three successive
// censuses read those guards as unreachable. A JavaScript source lowers a
// stdlib global taken as a value into the `[builtin Object]` identity
// token, so the chain's never-nullish arm re-dispatches the plain call and
// the guard declines it, dropping the site onto the member fence.
//
// This is the loud form of the defect: not a build that fails, a program
// that builds and traps. zapo's own spec/proto/index.js is JavaScript, and
// so is most bundled third-party code.
//
// Every receiver here is a stdlib global — never nullish — so `?.` IS `.`
// and the values must agree with the plain spelling member for member.
// What a lost guard would cost is not a value but an EVALUATION, so the
// argument counters below are the real assertion, and the genuinely
// nullish arm at the bottom pins the half a conversion loses silently.

const o = { a: 1, b: 2, c: 3 };

// ── Object statics ────────────────────────────────────────────────────
console.log("keys:", Object?.keys(o).join(","));
console.log("values:", Object?.values(o).join(","));
console.log("entries:", Object?.entries(o).map((e) => e[0] + "=" + e[1]).join(","));
console.log("agrees:", Object?.keys(o).length === Object.keys(o).length);

const merged = Object?.assign({ x: 0 }, { y: 9 });
console.log("assign:", merged.x, merged.y);

const frozen = Object?.freeze({ p: 5 });
console.log("freeze:", frozen.p);

// ── Array.isArray, through a BOUND value (a computed argument keeps its
//    own pre-existing fence in both spellings — see below) ─────────────
const arr = [1, 2, 3];
const notArr = "nope";
console.log("isArray:", Array?.isArray(arr), Array?.isArray(notArr));
console.log("isArray agrees:", Array?.isArray(arr) === Array.isArray(arr));

// ── ArrayBuffer.isView ────────────────────────────────────────────────
const u8 = new Uint8Array(4);
console.log("isView:", ArrayBuffer?.isView(u8));

// ── Symbol statics ────────────────────────────────────────────────────
const sym = Symbol?.for("scriptc.tag");
console.log("keyFor:", Symbol?.keyFor(sym));
console.log("for is interned:", Symbol?.for("scriptc.tag") === sym);

// ── RegExp.escape ─────────────────────────────────────────────────────
console.log("escape:", RegExp?.escape("a.b"));

// ── Array.from, mapper and mapper-less ────────────────────────────────
console.log("from mapped:", Array?.from({ length: 3 }, (_, i) => i * 2).join(","));
console.log("from string:", Array?.from("abc").join("-"));

// ── Buffer statics ────────────────────────────────────────────────────
const buf = Buffer?.from("hi");
console.log("buffer len:", buf.length, "hex:", buf.toString("hex"));
console.log("alloc:", Buffer?.alloc(3).length);

// ── Date.now ──────────────────────────────────────────────────────────
const t = Date?.now();
console.log("date.now is a recent epoch:", t > 1600000000000);

// ── stream.Readable.from ──────────────────────────────────────────────
const { Readable } = require("node:stream");
const r = Readable?.from(["a", "b"]);
console.log("readable is an object:", typeof r === "object" && r !== null);

// ── THE ARGUMENT RULE, pinned against an EFFECT ───────────────────────
// A never-nullish receiver runs the call, so its arguments evaluate
// exactly once — no more (a re-dispatch that lowered the argument twice
// would move this counter to 2) and no fewer.
let argEvals = 0;
function tick(v) {
    argEvals = argEvals + 1;
    return v;
}
console.log("with effectful arg:", Object?.keys(tick(o)).length);
console.log("arg evals:", argEvals);
console.log("keyFor with effectful arg:", Symbol?.keyFor(Symbol.for(tick("scriptc.tag"))));
console.log("arg evals:", argEvals);
console.log("values with effectful arg:", Object?.values(tick(o)).join(","));
console.log("arg evals:", argEvals);

// The STATICALLY-DECIDED members (Array.isArray, ArrayBuffer.isView,
// Buffer.from, Array.from) reject a computed argument in BOTH spellings —
// a pre-existing limit of those lowerings, not of the optional link — so
// nothing about `?.` is what refuses there. Only the agreement is claimed.

// The RECEIVER is not consumed by any of these lowerings and must not be
// evaluated twice either — the chain lowers it, discards it, and
// re-dispatches, which is only correct because a stdlib global has no
// effect. A call receiver is the observable version of that, and it keeps
// its own fence in BOTH spellings, so what is pinned here is the global.
console.log("plain and chained agree:", Object.keys(o).join(",") === Object?.keys(o).join(","));

// ── THE SHORT-CIRCUIT, which none of the above can exercise ───────────
// Every receiver above is never nullish, so `?.` never short-circuits
// there. A genuinely nullish receiver must evaluate NEITHER the member
// NOR its arguments, and must answer undefined.
let skipped = 0;
function boom() {
    skipped = skipped + 1;
    return "b";
}
function maybeText(on) {
    return on ? "abc" : undefined;
}
console.log("present:", maybeText(true)?.indexOf(boom()));
console.log("evals after present:", skipped);
console.log("absent:", maybeText(false)?.indexOf(boom()));
console.log("evals after absent:", skipped);
console.log("absent is undefined:", maybeText(false)?.indexOf(boom()) === undefined);
console.log("evals after absent again:", skipped);
