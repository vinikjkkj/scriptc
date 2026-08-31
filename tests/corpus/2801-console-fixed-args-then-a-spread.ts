// console.* with FIXED arguments followed by a spread -- zapo's
// benchLogger shape (`console.warn('[lib warn]', ...args)`).
//
// Node's console formatter is TOTAL over the whole argument list: every
// argument joins with one space and renders at the rest-args depth, so the
// fixed arguments are not a separate case -- they are the first entries of
// a list whose LENGTH is a runtime fact. Every pair below prints the same
// values twice, once through the fixed-arity path and once through the
// spread path, so a divergence between the two renderings is visible in
// ONE program. A test that could not tell them apart would not be a test.
function tag(...args: unknown[]): void {
  console.log("[tag]", ...args);
}
function two(a: unknown, ...rest: unknown[]): void {
  console.log("A", a, "B", ...rest);
}

// The EMPTY tail: Node prints no trailing space. Rendering the fixed
// arguments here and appending a joined tail as a further console argument
// would print "[tag] " -- which is why the whole list becomes ONE pack.
tag();
console.log("[tag]");

// Scalars, including -0, NaN and both infinities.
tag(1, "s", true, -0, 0, NaN, Infinity, -Infinity);
console.log("[tag]", 1, "s", true, -0, 0, NaN, Infinity, -Infinity);

// The unit values.
tag(null, undefined);
console.log("[tag]", null, undefined);

// Composites at the rest-args depth 2 (a string INSIDE a composite is
// quoted; a string argument is verbatim -- the console.log/inspect split).
tag({ a: 1, b: { c: [1, 2] } }, [1, "x", null]);
console.log("[tag]", { a: 1, b: { c: [1, 2] } }, [1, "x", null]);

// A string that LOOKS like a format specifier but is not the FIRST
// argument: no substitution runs.
tag("%s", "not-substituted");
console.log("[tag]", "%s", "not-substituted");

// Forwarding a rest slot into another rest slot, with a fixed argument
// between the two spreads' worth of values.
two("first", "x", 2, false);

// A statically-typed array spread -- not a rest binding.
const xs: string[] = ["p", "q"];
console.log("head", ...xs);
console.log("head", "p", "q");

// The same, empty.
const empty: string[] = [];
console.log("head", ...empty);
console.log("head");

// The spread FIRST, a fixed argument after: the position V8 does NOT take
// its optimized apply path for.
const mid: number[] = [7, 8];
console.log("pre", ...mid, "post");
console.log("pre", 7, 8, "post");

// console.warn and console.error are ONE stream in Node (warn IS error),
// and both carry the same formatting.
function warn(...args: unknown[]): void {
  console.warn("[w]", ...args);
}
warn("to", "stderr", 3);
console.warn("[w]", "to", "stderr", 3);
warn();
console.warn("[w]");
console.error("[e]", ...xs);
console.error("[e]", "p", "q");

// A boxed function value prints Node's [Function: name] form.
function named(): void {}
tag(named, () => 1);
console.log("[tag]", named, () => 1);

// A string spread walks by code point, a Uint8Array by byte.
console.log("str", ..."ab");
console.log("str", "a", "b");
const bytes = new Uint8Array([1, 2]);
console.log("bytes", ...bytes);
console.log("bytes", 1, 2);
