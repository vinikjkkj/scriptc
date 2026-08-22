// `F.prototype.constructor = F` is a [[Set]] over a property that ALREADY
// EXISTS, and ES keeps every attribute of an existing own data property and
// changes only its value. A function's prototype object is born carrying
// `constructor` as { writable: true, enumerable: FALSE, configurable: true },
// so after the assignment `Object.keys(F.prototype)` is still `[]` in Node.
//
// This runtime deliberately does not STORE that backlink -- the prototype
// would hold a FUNC box holding the closure holding the property table
// holding the prototype, a ring reference counting cannot break -- so its
// value comes out of a pointer-keyed registry (scr_json.c's ScrCtorSlot).
// `in`, `Object.hasOwn` and the READ all answered off that registry and were
// exact; the assignment fell through to the ordinary member write, which put
// the key into `entries`. `entries` is EVERY enumeration surface at once, so
// one missing attribute came out as six wrong answers, all silent:
// Object.keys / values / entries, Object.assign, structuredClone,
// JSON.stringify (which happened to agree, because a function value is
// omitted), util.inspect (`F { constructor: [Function: F] }` for a receiver
// Node prints as `{}`) and assert.deepStrictEqual (which THREW where Node
// passes).
//
// The mirror of the same hole is `Object.getOwnPropertyNames`: the own-names
// walk is "Object.keys plus `length`", and a name in neither table is
// invisible to it, so an UNTOUCHED prototype answered `[]` where Node answers
// `["constructor"]` -- the silently SHORT list that scr_dyn_own_names_fence
// refuses to produce for every other non-enumerable property. It is put back
// at index 0 because own string keys list in CREATION order and a prototype
// is born with this one.
//
// The narrowness matters as much as the fix. On any other receiver Node has
// no own `constructor` to preserve, so the ES5 idiom
// `C.prototype = Object.create(P.prototype); C.prototype.constructor = C`
// creates an ordinary ENUMERABLE property and Object.keys DOES list it --
// measured on v25.9.0 before the rule was written, and asserted here so a
// later widening cannot pass.

import { inspect } from "node:util";

function F() {}
F.prototype.constructor = F;
const p = F.prototype;

console.log("keys=" + JSON.stringify(Object.keys(p)));
console.log("gopn=" + JSON.stringify(Object.getOwnPropertyNames(p)));
console.log("entries=" + JSON.stringify(Object.entries(p).map((e) => e[0])));
console.log("values=" + Object.values(p).length);
console.log("assign=" + JSON.stringify(Object.keys(Object.assign({}, p))));
console.log("clone=" + JSON.stringify(Object.keys(structuredClone(p))));
console.log("json=" + JSON.stringify(p));
console.log("inspect=" + inspect(p));
console.log("hasOwn=" + Object.hasOwn(p, "constructor"));
console.log("in=" + ("constructor" in p));
console.log("name=" + p.constructor.name);

// An instance of it: `constructor` is inherited, never own, and util.inspect
// DOES prefix an instance with the name it refuses the prototype (Node keeps
// an own `constructor` descriptor only while `value instanceof
// descriptor.value`, which a prototype fails against its own constructor).
const inst = new F();
console.log("ikeys=" + JSON.stringify(Object.keys(inst)));
console.log("ihasOwn=" + Object.hasOwn(inst, "constructor"));
console.log("iname=" + inst.constructor.name);
console.log(inst);
console.log(p);

// A prototype nobody assigned to: the own-names list must still carry the
// name, and it must come FIRST, before the members the program added.
function G() {}
G.prototype.m = function () { return 1; };
console.log("gkeys=" + JSON.stringify(Object.keys(G.prototype)));
console.log("ggopn=" + JSON.stringify(Object.getOwnPropertyNames(G.prototype)));

// The delete: configurable, so it succeeds, the OWN property goes away, and a
// later assignment creates an ordinary enumerable member -- while `in` keeps
// answering true, because the chain still reaches one.
function H() {}
H.prototype.constructor = H;
console.log("hdel=" + (delete H.prototype.constructor));
console.log("hhasOwn=" + Object.hasOwn(H.prototype, "constructor"));
console.log("hin=" + ("constructor" in H.prototype));
console.log("hgopn=" + JSON.stringify(Object.getOwnPropertyNames(H.prototype)));
H.prototype.constructor = H;
console.log("hkeys2=" + JSON.stringify(Object.keys(H.prototype)));

// And the receiver the rule must NOT reach.
function P() {}
function C() {}
C.prototype = Object.create(P.prototype);
C.prototype.constructor = C;
console.log("ckeys=" + JSON.stringify(Object.keys(C.prototype)));
console.log("cgopn=" + JSON.stringify(Object.getOwnPropertyNames(C.prototype)));
console.log("cinspect=" + inspect(C.prototype));
