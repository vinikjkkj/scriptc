// npm-static pilot: the ES5 constructor-function idiom, and the compiler
// CRASH that stood behind the field-outside-constructor diagnostic's own
// remedy.
//
// `SC1090: fields assigned outside the constructor's top level` told the
// user to "assign it unconditionally at the top of the constructor". Doing
// exactly that on `pg/lib/client.js` moved the refusal along three sites
// and then killed the compiler with `TypeError: Cannot read properties of
// undefined (reading 'map')` — no code, no location, no file. The crash
// had nothing to do with the field: satisfying the fence merely let the
// constructor lower far enough to reach `new TypeOverrides(...)`, and it
// is `pg/lib/type-overrides.js` — an ES5 constructor FUNCTION, not a class
// — that the lowerer could not survive. ctorfn/index.js carries the three
// conditions that have to hold at once.
//
// It reproduces ONLY through --npm-static: the identical source as a
// program module is recognised as a JS constructor-function class and
// never takes the implicit-any function-VALUE path. That is why a
// hand-written class "with the same shape" compiled and ran, and why the
// survey that found this concluded it needed pg's real context and left it
// without a repro.
import ctorfn from "ctorfn";

const c = new ctorfn.Client({ int4: "number", text: "string" });
console.log("name", c.name);
console.log("read", c.read("int4"), c.read("text"), c.read("missing"));
console.log("tag", c._over.tag);

// The prototype methods whose `Overrides.prototype` receiver is the VALUE
// reference the whole crash hangs on — driven through the class, because a
// program-side `new Overrides(...)` is a separate, still-open limitation.
console.log("chain", c._over.set("a", 1).set("b", 2).get("b"));
console.log("kept", c._over.get("a"));

// A second Client keeps its own table.
const c2 = new ctorfn.Client(null);
console.log("second", c2.read("int4"), c2._over.tag);
