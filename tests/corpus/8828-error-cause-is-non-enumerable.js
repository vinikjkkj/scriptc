// `new Error(message, { cause })` and `super(message, { cause })` store the
// error's own NON-enumerable `cause`: read statically and through an untyped
// slot, hidden from Object.keys, kept hidden when assigned over, and an
// ordinary enumerable property when first created by assignment. The store
// used to be an enumerable property, which Object.keys listed.
'use strict';

const inner = new Error("inner");
const e = new Error("outer", { cause: inner });
console.log(e.cause.message, e.message);

class X extends Error {
  constructor(m, c) { super("x:" + m, { cause: c }); this.name = "X"; }
}
const x = new X("m", "why");
console.log(x.cause, x.message, x.name);

class Y extends Error {}
const y = new Y("y", { cause: 5 });
console.log(y.cause, y.message);

const z = new RangeError("r", { cause: { code: 7 } });
console.log(z.cause.code);

const w = new Error("no cause", { other: 1 });
console.log(w.cause);

e.cause = "assigned";
console.log(e.cause);

function causeOf(err) { return err.cause; }
function hasCause(err) { return "cause" in err; }
function keysOf(err) { return Object.keys(err).join(","); }
console.log(causeOf(e), causeOf(x), causeOf(y), causeOf(z).code, causeOf(w));
console.log(hasCause(e), hasCause(x), hasCause(w));
console.log("[" + keysOf(e) + "]", "[" + keysOf(x) + "]", "[" + keysOf(y) + "]", "[" + keysOf(z) + "]");

const f = new X("f", undefined);
f.cause = "late";
console.log(f.cause, "[" + keysOf(f) + "]");
