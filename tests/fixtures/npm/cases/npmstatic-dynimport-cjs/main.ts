// REPRO, self-contained in this repo's own fixtures: the namespace
// `--npm-static` builds for a dynamic import() of a BUNDLER-EMITTED CJS
// package has none of the package's named exports.
//
// gtdefine's barrel is the `Object.defineProperty(exports, 'n', { get })`
// family, which npm-static-rewrite.ts rewrites into `module.exports = {…}` --
// an `export=`. staticDynNsBuilderOf builds the namespace from
// `modSym.getExports()`, and that table holds ONE entry for an `export=`, so
// the namespace gets `default` and nothing else.
//
// Node prints:      leaf function  WIDTH number
// Compiled prints:  leaf undefined  WIDTH undefined
//
//   node tests/fixtures/npm/cases/npmstatic-dynimport-cjs/main.ts
//   <compiled with --npm-static gtdefine>
//
// The suite that pins namespace behaviour (tests/harness/module-ns-value.test.ts)
// stages ESM packages only, where getExports() carries every name, so this shape
// has no coverage.
export {};
const ns = (await import("gtdefine")) as unknown as Record<string, unknown>;
console.log("leaf", typeof ns["leaf"]);
console.log("WIDTH", typeof ns["WIDTH"]);
