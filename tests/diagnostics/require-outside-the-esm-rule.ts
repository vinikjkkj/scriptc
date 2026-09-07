/* The two `require` spellings the ES-module rule deliberately does NOT
 * claim, pinned from outside so the boundary is tested by what it refuses.
 *
 * The rule it does claim: in an ES MODULE, `require` is not a binding at
 * all (Node defines it only in a CommonJS module), so a read of it is
 * `ReferenceError: require is not defined` — corpus 7789.
 *
 * THIS FILE IS NOT AN ES MODULE. It declares nothing and imports nothing,
 * so it is a SCRIPT, and both `ts.isExternalModule` and Node's own
 * type-stripping loader read it as CommonJS — where `require` IS bound and
 * DOES resolve (measured: Node v25.9.0 answers MODULE_NOT_FOUND here, not
 * a ReferenceError). Answering the ES-module ReferenceError in this file
 * would therefore be a WRONG answer rather than a missing one, and the
 * SC2020 refusal below is the honest under-approximation: the CommonJS
 * require family in lower-builtins is gated on isCjsJsFile — a JavaScript
 * file — so a CommonJS-kind TypeScript file has no lowering on either
 * side and keeps the lib fence.
 *
 * The `globalThis.require` spelling is refused for a different reason and
 * in BOTH module kinds: `require` is module-scoped and is NOT a property
 * of the global object anywhere, so Node's answer is `undefined` and the
 * call is a TypeError. The refusal is one step short of that answer; it is
 * recorded here so the step is a decision and not an oversight. */

function load(): unknown {
    return require("some-package");
}
console.log(String(load()));

console.log(String(globalThis.require("some-package")));
