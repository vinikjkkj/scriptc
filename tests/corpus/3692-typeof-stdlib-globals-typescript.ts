// The same fold, in a TypeScript source, where the old answer was not a
// wrong value but a COMPILE ERROR.
//
// A TS source has no identity token: a stdlib global taken as a value is
// SC2020, "part of the standard library types but has no scriptc lowering
// yet". `typeof Math` therefore did not build at all — and the fence was
// naming a value the program never asked for, because `typeof` only ever
// wanted the KIND. Twelve globals moved from a hard build failure to
// Node's answer here.
//
// The fence on the VALUE is unchanged and still the right answer: taking
// `Math` as a value in TypeScript is still SC2020. Only the question
// changed.

// ── the twelve that were SC2020 compile errors ─────────────────────────
console.log("Math:", typeof Math, "JSON:", typeof JSON);
console.log("Reflect:", typeof Reflect, "Intl:", typeof Intl);
console.log("globalThis:", typeof globalThis, "global:", typeof global);
console.log("process:", typeof process, "console:", typeof console);
console.log("performance:", typeof performance);
console.log("Buffer:", typeof Buffer, "MessagePort:", typeof MessagePort);
console.log("AbortSignal:", typeof AbortSignal);

// ── the callable ones answered "function" before and still do ──────────
console.log("Object:", typeof Object, "Array:", typeof Array);
console.log("Promise:", typeof Promise, "Symbol:", typeof Symbol);
console.log("Uint8Array:", typeof Uint8Array, "Date:", typeof Date);
console.log("setTimeout:", typeof setTimeout, "fetch:", typeof fetch);
console.log("String:", typeof String, "Number:", typeof Number);

// ── primitives ─────────────────────────────────────────────────────────
console.log("Infinity:", typeof Infinity, "NaN:", typeof NaN);
console.log("undefined:", typeof undefined);

// ── the globalThis.<name> spelling, and a CAST over the receiver ───────
console.log("gt.Math:", typeof globalThis.Math, "gt.Buffer:", typeof globalThis.Buffer);
console.log("gt.process:", typeof globalThis.process);
console.log(
  "cast:",
  typeof (globalThis as typeof globalThis & { process?: unknown }).process,
);

// ── the sniffs a real program writes ───────────────────────────────────
console.log("has-process:", typeof process !== "undefined");
console.log("is-object:", typeof Math === "object", typeof JSON === "object");
console.log("is-fn:", typeof Buffer === "function", typeof Promise === "function");

// ── a shadowing local is not a stdlib symbol and keeps the plain path ──
{
  const JSON = { n: 1 };
  console.log("shadowed:", typeof JSON, JSON.n);
}
function shadow(Math: number): string {
  return typeof Math;
}
console.log("param:", shadow(2));

// ── the VALUE fence is untouched: this is still what a program may not do
// (kept as a comment, because a corpus program must build)
//   const m = Math;                  // SC2020 'Math'
//   console.log(JSON.stringify(m));  // SC2020 'JSON'
