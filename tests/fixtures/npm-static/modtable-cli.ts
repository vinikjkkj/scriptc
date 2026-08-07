// npm-static pilot: esbuild's `__commonJS` MODULE TABLE — the bundler shape
// `r({ "node_modules/x.js"(e, t) { ... } })`, a shorthand METHOD keyed by a
// string literal inside an object literal whose contextual type is `any`
// (the helper's parameter is untyped, so the literal takes the JS
// declaration fallback and builds as a dyn object).
//
// The table's ACCESS path rides with it: `var o = Object.getOwnPropertyNames`
// is a builtin in VALUE position, bound at module scope and read from
// inside the returned thunk — which is a monomorphized instance that takes
// no captures, so the binding needs module STORAGE rather than a capture
// thread. Both are driven here, and `family` drives the twin the lift also
// covers — over the receivers where the own-NAMES walk and the own-KEYS
// walk part company.
//
// The three modules cross-require through the memoizing thunk, so the
// differential also pins that each body runs EXACTLY ONCE.
import modtable from "modtable";

const hex = (bytes: number[]): string => bytes.map((b) => b.toString(16).padStart(2, "0")).join("");

console.log("field1", hex(modtable.encodeField(1, 0)));
console.log("field2", hex(modtable.encodeField(2, 1)));
console.log("field3", hex(modtable.encodeField(3, 127)));
console.log("field4", hex(modtable.encodeField(4, 128)));
console.log("field5", hex(modtable.encodeField(5, -1)));
console.log("field6", hex(modtable.encodeField(6, 16384)));
console.log("names", modtable.names());
console.log("family", modtable.family());
// each module body appended its name once, in first-call order
console.log("order", modtable.order());
