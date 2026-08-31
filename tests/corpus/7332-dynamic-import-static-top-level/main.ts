// The served dynamic import at FILE SCOPE (top-level await), which is a
// different lowering PHASE from the same shape inside a function: file-scope
// globals are collected by collectProgram, which runs BEFORE the module-init
// tables exist. A serve-check that consulted those tables answered "cannot
// serve" for every top-level declaration, gave the binding storage, and then
// made the statement lowering refuse because storage existed -- served inside
// a function, silently not served here. Both spellings are pinned below.
//
// What resolves is straight-line code after the import and lambdas created
// after it. A hoisted `function` declaration cannot read these bindings at
// all, wherever it sits, and says so by name (tests/diagnostics/
// dynamic-import-static-positions).
export {}
const { VAL, greet, Thing } = await import("./mod.ts")
console.log("VAL", VAL)
console.log("greet", greet("top"))
console.log("double", new Thing(6).double())

// A lambda created after the import closes over the same names.
const readIt = (): number => VAL
const twice = (n: number): number => new Thing(n).double()
console.log("via lambda", readIt(), twice(7))

// The whole-namespace spelling at file scope, and the key set it folds to.
const ns = await import("./mod.ts")
console.log("keys", Object.keys(ns).join(","))
console.log("ns.VAL", ns.VAL, "ns.default", ns.default)

// Evaluated once: "mod evaluated" prints a single time above.
const { counter, bump } = await import("./mod.ts")
console.log("counter", counter, "bump", bump())
