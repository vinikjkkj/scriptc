// The namespace `--npm-static` builds for a dynamic import() of a
// BUNDLER-EMITTED CJS package, differentially against Node. Driven with
// `--npm-static gtdefine` from npm-static.test.ts (with 2465-2468, whose
// packages this one shares); it is NOT in npm.test.ts's flagless lane —
// under the island the namespace is a jsval and this file's cast is
// `SC1090: a checked cast of 'any' to 'unknown'`. See npm-cases.ts.
//
// WHAT IT WAS, and why the fixture reads this way. gtdefine's barrel is
// the `Object.defineProperty(exports, 'n', { get })` family, which
// npm-static-rewrite.ts rewrites into `module.exports = {…}` — an
// `export=`. staticDynNsBuilderOf built the namespace from
// `modSym.getExports()`, and that table holds ONE entry for an `export=`,
// so the namespace got `default` and nothing else, and `default` crossed
// as a trap function. Measured on the parent of this change, under
// node v25.9.0:
//
//   node                                    leaf function   WIDTH number
//   compiled --npm-static gtdefine          leaf undefined  WIDTH undefined
//     (build green, status "static", zero diagnostics, exit 0)
//
// Node's namespace and the compiled one shared NO key. The builder now
// reads the name set off the rewritten export table — the same table a
// member read resolves through — so both sides answer
// `WIDTH,__esModule,default,leaf,module.exports`.
//
// tests/harness/module-ns-value.test.ts pins the cells one by one, on
// both backends, including the ones this file does not print: the key
// set, `default` being the module.exports OBJECT, and the
// `module.exports` alias being that same object.
export {};
const ns = (await import("gtdefine")) as unknown as Record<string, unknown>;
console.log("leaf", typeof ns["leaf"]);
console.log("WIDTH", typeof ns["WIDTH"]);
