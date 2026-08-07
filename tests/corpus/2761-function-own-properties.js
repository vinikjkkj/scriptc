// Own properties written onto a FUNCTION value — JavaScript's pre-ES6 way
// of giving a constructor its statics, and the flat half of what
// `pbjs --target static-module` emits. The receiver is a function
// declaration NESTED inside a factory, so the expando rule (module globals,
// top-level receivers only) cannot claim it: one global would alias every
// instantiation.
//
// The storage is the CLOSURE's own-property table, which the keyed READ has
// answered from since the first commit; the write and the method call now
// answer from the same table. What that buys has to be pinned by IDENTITY,
// not by a single round trip: a per-use box is only correct if two boxes of
// one function value share a table AND two function values from two calls of
// one factory do not. Both are below, and Node is the oracle for both.
//
// A JavaScript entry on purpose: the route is gated on JS files, exactly
// like the read arm it joins, because in TypeScript the checker has a
// declared member type at every such access.

"use strict";

/** @param {string} tag */
function makeCodec(tag) {
  function Codec(n) {
    return tag + ":" + n;
  }
  // Every value kind a member can hold, written through the box.
  Codec.TAG = tag;
  Codec.count = 0;
  Codec.ok = true;
  Codec.nothing = null;
  Codec.opts = { deep: tag + "!" };
  Codec.encode = function (m) {
    return "E" + m;
  };
  // A read-then-write through the same table.
  Codec.count = Codec.count + 1;
  // A function-VALUED member CALLED through its receiver, here where
  // `Codec` is still a local function value rather than a dyn binding —
  // pbjs's `Codec.encode(msg)`, dispatched through the same table with the
  // receiver bound.
  Codec.self = Codec.encode(0);
  // The same write in VALUE position: a minifier writes `x = (a.k = v, …)`
  // and the shipped protobuf bundle is one such chain end to end. The
  // expression's value is the RHS, and the write lands in the same table.
  const yielded = (Codec.tagged = tag + "!");
  Codec.viaValue = yielded;
  return Codec;
}

const A = makeCodec("a");
const B = makeCodec("b");

// Two boxes of ONE function value share ONE table: this read is a different
// box from the one each write above created.
console.log(A.TAG, A.count, A.ok, A.nothing, A.opts.deep);
console.log(B.TAG, B.count, B.ok, B.nothing, B.opts.deep);
console.log(A.self, A.tagged, A.viaValue, B.self, B.tagged, B.viaValue);

// A function-VALUED member, called through its receiver — pbjs's whole API
// shape (`Codec.encode(msg)`).
console.log(A.encode(7), B.encode(8));

// An absent own property is `undefined`, not an error.
console.log(String(A.missing));

// The value is still a function, and still callable.
console.log(typeof A, A(1), B(2));

// A write through ONE instance must not be visible through the OTHER: each
// call of the factory created a fresh function object, so a fresh table.
A.TAG = "a2";
A.count = A.count + 10;
console.log(A.TAG, B.TAG, A.count, B.count);

// A member overwritten with a different kind reads back as that kind.
A.count = "eleven";
console.log(A.count, typeof A.count);

// Members survive being handed through an untyped hop, because the table is
// on the closure and not on any one box.
/** @param {any} f */
function passThrough(f) {
  return f;
}
const C = passThrough(A);
console.log(C.TAG, C.encode(3));
C.TAG = "a3";
console.log(A.TAG);

// The same write arrives in VALUE position too — a minifier writes
// `x = (a.k = v, …)`, and the shipped protobuf bundle is one such chain end
// to end. The expression's value is the RHS, and the write still lands in
// the same table the statement form writes.
const chained = (B.chain = "C");
console.log(chained, B.chain);
const seq = (A.tagged = "T", A.encode(5));
console.log(seq, A.tagged);

// A function declaration at module scope with NO member writes is untouched
// by any of this — it stays a direct static call.
function plain(x) {
  return x * 2;
}
console.log(plain(21));
