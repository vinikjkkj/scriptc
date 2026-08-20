// `typeof require` / `typeof __dirname` / `typeof __filename` in an ES
// MODULE, and the same names read off globalThis.
//
// The five CommonJS module globals are MODULE-SCOPE bindings of a
// CommonJS module. Node never defines them in an ES module (a bare read
// is `ReferenceError: __dirname is not defined in ES module scope`), and
// it never puts them on the global object in EITHER module kind. The
// standard library declares them ambiently all the same, so a fold that
// reads only the DECLARED KIND — which is all a declaration can offer —
// answered "function"/"string" for every one of them, everywhere:
//
//     base compiler, this exact file:      Node v25.9.0:
//       typeof require   = function          typeof require   = undefined
//       typeof __dirname = string            typeof __dirname = undefined
//       typeof __filename = string           typeof __filename = undefined
//       typeof globalThis.require = function typeof globalThis.require = undefined
//
// Exit 0, no trap, no diagnostic — which is the whole point: every
// vendored bundle that sniffs its environment with
// `typeof require === "function"` took the CommonJS branch inside an ES
// module. protobufjs's `inquire` is one such bundle; there are many.
//
// This file is an ES module two ways over: tests/corpus/package.json is
// `{ "type": "module" }`, and the `export {}` below is the syntactic
// marker Node's own detection uses. Its CommonJS twin is
// 5451-typeof-the-cjs-module-globals-in-a-commonjs-module.cjs, which must
// keep the answers it already had.

console.log("typeof require =", typeof require)
console.log("typeof __dirname =", typeof __dirname)
console.log("typeof __filename =", typeof __filename)

// The globalThis spellings: never properties of the global object.
console.log("typeof globalThis.require =", typeof globalThis.require)
console.log("typeof globalThis.__dirname =", typeof globalThis.__dirname)
console.log("typeof globalThis.__filename =", typeof globalThis.__filename)

// A cast over the receiver reaches the same global (the canonical
// spelling for naming a member the ambient types declare differently).
console.log("cast =", typeof (globalThis as typeof globalThis).require)

// The shape that made this a wrong ANSWER rather than a wrong string: a
// vendored bundle's environment sniff picks a branch off it.
console.log(typeof require === "function" ? "cjs-branch" : "esm-branch")
console.log(typeof require === "undefined" ? "no-require" : "has-require")
if (typeof __dirname !== "undefined") {
    console.log("would-use-dirname")
} else {
    console.log("no-dirname")
}

// The same question asked of a global that is NOT module-scoped: the
// declaration-shaped fold still owns these, in both module kinds.
console.log("process =", typeof process, "Buffer =", typeof Buffer)
console.log("Math =", typeof Math, "setTimeout =", typeof setTimeout)

export {}
