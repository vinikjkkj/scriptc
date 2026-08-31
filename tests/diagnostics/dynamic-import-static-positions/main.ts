/* The dynamic import() positions a STATIC build does NOT serve, each with
 * its own reason named. The tier serves exactly two spellings — `const ns
 * = await import("./m.ts")` and `const { a } = await import("./m.ts")` —
 * and every message below names the one that works for its case (corpus
 * 7330/7331 compile and run those). */
async function unbound(): Promise<void> {
  // Not awaited AT the declaration: the promise is a value, and the tier
  // materializes no namespace object for it to settle to.
  const p = import("./mod.ts");
  console.log((await p).VAL);
}
async function mutable(): Promise<void> {
  // `let`: the binding is storage, and this plumbing has none.
  let ns = await import("./mod.ts");
  console.log(ns.VAL);
}
async function firstClass(): Promise<void> {
  // Served at the declaration, then used as a VALUE — the namespace
  // OBJECT, which Node makes exotic and this tier does not build.
  const ns = await import("./mod.ts");
  const alias: unknown = ns;
  console.log(typeof alias);
}
async function identity(): Promise<void> {
  // Node returns the SAME namespace object for two imports of one
  // specifier, so `a === b` is true there. This tier builds no namespace
  // object at all, which is why the comparison is refused rather than
  // answered: the module still evaluates exactly once (corpus 7330 pins
  // that), but the OBJECT whose identity the comparison asks about does
  // not exist.
  const a = await import("./mod.ts");
  const b = await import("./mod.ts");
  console.log(a === b);
}
async function topLevelAwait(): Promise<void> {
  // The module's own evaluation is a promise.
  const { T } = await import("./tla.ts");
  console.log(T);
}
async function self(): Promise<void> {
  // The entry importing itself: nothing left to evaluate.
  const { SELF } = await import("./main.ts");
  console.log(SELF);
}
// A binding of a SERVED file-scope import read from a hoisted `function`
// declaration. The plumbing has no storage, and a `function` body lowers on
// its own, so the name has nothing to resolve to -- above the import or
// below it alike (both spellings were compiled; moving the function down
// does not help). Straight-line reads after the import and lambdas created
// after it DO resolve, and corpus 7332 runs both.
function tooEarly(): number { return LATE; }
const { VAL: LATE } = await import("./mod.ts");
console.log(tooEarly(), LATE);
export const SELF = 1;
void unbound(); void mutable(); void firstClass(); void identity();
void topLevelAwait(); void self();
