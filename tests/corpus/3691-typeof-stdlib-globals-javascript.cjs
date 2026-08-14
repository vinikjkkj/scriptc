// `typeof` on a stdlib global, in a JavaScript source.
//
// A JS source lowers a stdlib global taken as a VALUE into the identity
// token `[builtin X]` — an interned STRING — so lowering the operand of a
// `typeof` answered "string" for every global that is not callable. It was
// a silent wrong answer with no trap in sight: `typeof Math` said "string"
// where Node says "object", and so did JSON, globalThis, process, console,
// Reflect, Intl, performance, global, Buffer, MessagePort and AbortSignal.
//
// The answer is now read off the declared KIND instead, which is the one
// question about a global that never needs its value. The token itself is
// untouched — the identity block at the bottom is the assertion that says
// so, and it must keep the answers it had before.

// ── the callable globals (unchanged: the declared type has signatures) ──
console.log("Object:", typeof Object, "Array:", typeof Array);
console.log("Symbol:", typeof Symbol, "Promise:", typeof Promise);
console.log("Map:", typeof Map, "Set:", typeof Set, "Date:", typeof Date);
console.log("Error:", typeof Error, "RegExp:", typeof RegExp);
console.log("Uint8Array:", typeof Uint8Array, "Proxy:", typeof Proxy);
console.log("setTimeout:", typeof setTimeout, "fetch:", typeof fetch);
console.log("queueMicrotask:", typeof queueMicrotask);
console.log("structuredClone:", typeof structuredClone);
console.log("URL:", typeof URL, "TextEncoder:", typeof TextEncoder);

// ── the namespace objects: "string" before, "object" in Node ───────────
console.log("Math:", typeof Math, "JSON:", typeof JSON);
console.log("Reflect:", typeof Reflect, "Intl:", typeof Intl);
console.log("globalThis:", typeof globalThis, "global:", typeof global);
console.log("process:", typeof process, "console:", typeof console);
console.log("performance:", typeof performance);

// ── the constructor objects the declaration writes statics-only ────────
// `new Buffer()` is gone from Node's API and MessagePort/AbortSignal are
// not constructible here either, so none of the three carries a construct
// signature — and Node still answers "function", because the value is a
// function object.
console.log("Buffer:", typeof Buffer, "MessagePort:", typeof MessagePort);
console.log("AbortSignal:", typeof AbortSignal);

// ── the primitives: unchanged ──────────────────────────────────────────
console.log("Infinity:", typeof Infinity, "NaN:", typeof NaN);
console.log("undefined:", typeof undefined);

// ── the globalThis.<name> spelling reaches the same globals ────────────
console.log("gt.Math:", typeof globalThis.Math, "gt.JSON:", typeof globalThis.JSON);
console.log("gt.process:", typeof globalThis.process);
console.log("gt.Buffer:", typeof globalThis.Buffer);
console.log("gt.setTimeout:", typeof globalThis.setTimeout);
console.log("g.Math:", typeof global.Math, "g.process:", typeof global.process);

// ── a SHADOWING local keeps the ordinary path ──────────────────────────
{
  const Math = { pi: 3 };
  console.log("shadowed:", typeof Math, Math.pi);
}
function shadow(JSON) {
  return typeof JSON;
}
console.log("param:", shadow(1), shadow("s"), shadow(true));

// ── the environment sniff these globals are actually written for ───────
console.log("has-process:", typeof process !== "undefined");
console.log("is-node:", typeof process === "object" && typeof Buffer === "function");
console.log("has-buffer:", typeof Buffer === "function");
console.log("has-math:", typeof Math === "object");

// ── the TOKEN is untouched: identity, truthiness, String() all unmoved ─
const m1 = Math;
const m2 = Math;
const j = JSON;
console.log("identity:", m1 === m2, m1 === j, Math === Math);
console.log("truthy:", Math ? "y" : "n", JSON ? "y" : "n");
// NOT here: `typeof m1` through a BINDING still reads the token and still
// answers "string". The fold asks the checker about a global REFERENCE;
// a local bound to one is an ordinary string-typed value by then, and
// giving it the right answer needs the token to carry a kind — which is
// the generalisation a sibling measurement refuted. It is recorded, not
// pinned, because a fixture may only pin what is right.
