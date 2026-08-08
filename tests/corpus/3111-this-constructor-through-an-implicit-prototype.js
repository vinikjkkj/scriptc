// `this.constructor` through a function's IMPLICIT prototype object — the
// one member Node's prototype has and this runtime does not STORE.
//
// Storing it is what cannot be done: the prototype object would hold a FUNC
// box holding the closure holding the own-property table holding the
// prototype object, a cycle refcounting cannot break and the collector
// cannot see (ScrDyn carries no trace header, so a dyn→closure edge is an
// external root by construction). What the READ needs is smaller than a
// stored property, though — the closure's IDENTITY plus the five static
// literals a FUNC box is otherwise made of — so the runtime keeps a side
// registry from minted prototype object to that descriptor and mints a
// fresh box per read. The borrowed closure pointer is safe by construction
// rather than by counting: the closure OWNS its minted prototype, so the
// registry key can neither be freed nor have its address recycled, and both
// closure teardown paths erase the entry before anything else. The one
// direction that would cycle — prototype OWNING the function — is the one
// direction nothing stores.
//
// The site that made this a blocker is protobufjs's Writer, and section 1
// is it in miniature:
//
//     Writer.prototype.finish = function finish() {
//       return this.finishInto(this.constructor.alloc(this.len), 0);
//     };
//
// `Writer.create()` answers a plain Writer whenever `util.Buffer` is null —
// which it always is in a compiled program — so the BufferWriter subclass
// with its EXPLICIT `(r.prototype = Object.create(n.prototype)).constructor
// = r` never runs, and the implicit read is the whole path. The static the
// answered box has to reach (`alloc`) is the reason a fresh box works at
// all: a FUNC box's own-property table hangs off the CLOSURE, so every box
// of one function value shares it.
//
// The bundle's own `Writer.create = function () { return new Writer(); }`
// is deliberately NOT reproduced: a static that captures its own
// constructor is the class-B cycle refcounting already cannot break
// (closure → props box → table → member FUNC dyn → closure), it predates
// this item, and a fixture that carried it would report a leak that has
// nothing to do with the read under test. Section 5's explicit back-link
// is the same cycle in the other spelling and is unlinked at the end of
// the program for the same reason.
//
// DELIBERATE DIVERGENCES, none printed:
//   * A prototype object that OUTLIVES its function. The back-link is
//     borrowed, so when the last reference to the function goes away the
//     registry entry goes with it and the read reverts to the loud
//     not-supported-yet fence — where Node, which traces, still answers the
//     function. Extending the answer means a strong edge back to the
//     closure: from the prototype that is exactly the uncollectable cycle,
//     and from every instance it is a pointer on every object in the
//     program. A bounded refusal beats both.
//   * `F.prototype = {…}` replacing the minted object BEFORE any instance
//     exists. Those instances inherit from a plain literal, whose
//     `constructor` is %Object.prototype%'s — a prototype this tier does
//     not model — so the read answers undefined where Node answers
//     `Object`. Identical to a bare `({}).constructor`, which the static
//     tier fences at compile time. Section 5's third level is the case
//     where the replacement's own chain still reaches an EXPLICIT
//     back-link, and that one answers exactly.
//   * `===` between two function VALUES is SC2011's fence unless both
//     operands are checked-dynamic, so identity below is read through the
//     mixed arrays the shipped bundle's module table is shaped like.

"use strict";

// ── 1. protobufjs's Writer, in miniature ─────────────────────────────
// Nested in a factory exactly the way the shipped bundle nests it: every
// pbjs/esbuild module body is a function, so the constructor is a NESTED
// declaration and its statics land in the function value's own-property
// table rather than in a module global.
function writerModule() {
  function Writer() {
    this.len = 0;
    this.chunks = [];
  }
  Writer.alloc = function alloc(size) {
    return "buf(" + size + ")";
  };
  Writer.prototype.push = function push(n) {
    this.len += n;
    this.chunks.push(n);
    return this;
  };
  // The read under test. It reaches a STATIC through the answered box.
  Writer.prototype.finish = function finish() {
    return this.constructor.alloc(this.len);
  };
  return Writer;
}
var Writer = writerModule();

console.log("finish", new Writer().push(3).push(4).finish());
console.log("empty", new Writer().finish());

// ── 2. identity ──────────────────────────────────────────────────────
// A fresh box per read is still the same function OBJECT: identity is the
// CLOSURE, so two reads agree with each other and with the reference the
// program already holds. Distinct functions stay distinct — identity,
// never shape, so a second module with the same body is a different
// constructor.
function moduleTable() {
  var W = writerModule();
  return [new W(), W];
}
var m1 = moduleTable();
var m2 = moduleTable();
console.log("ctor === its function", m1[0].constructor === m1[1]);
console.log("ctor === ctor", m1[0].constructor === m1[0].constructor);
console.log("ctor === another module's", m1[0].constructor === m2[1]);
console.log("name/length", m1[0].constructor.name, m1[0].constructor.length);
console.log("typeof", typeof m1[0].constructor);

// The answered box CONSTRUCTS, and the statics reached through it are the
// same statics.
var w = new Writer();
var again = new w.constructor();
console.log("reconstructed", again instanceof Writer, again.len, again.finish());
console.log("static through the box", w.constructor.alloc(12));

// ── 3. the property, not just the value ──────────────────────────────
// `constructor` is an OWN property of the PROTOTYPE object in Node and of
// no instance below it, and it is NON-ENUMERABLE on both — so `in` and
// hasOwn see it where keys, JSON and the own-only walks do not.
console.log("in inst", "constructor" in w, "in proto", "constructor" in Writer.prototype);
console.log("hasOwn proto", Object.hasOwn(Writer.prototype, "constructor"));
console.log("hasOwn inst", Object.hasOwn(w, "constructor"));
console.log("keys(proto)", Object.keys(Writer.prototype).join(","));
console.log("keys(inst)", Object.keys(w).join(","));
console.log("json(inst)", JSON.stringify(w));

// ── 4. up the chain ──────────────────────────────────────────────────
// The walk does not stop at the first object carrying a constructor NAME
// (an instance copies one for util.inspect), so a chain threaded through
// an instance still reaches the prototype that was actually minted. And
// the read on the prototype object ITSELF is the own-property spelling.
var derived = Object.create(Writer.prototype);
derived.len = 9;
console.log("derived", derived.finish(), derived.constructor.alloc(1));
var viaInstance = Object.create(w);
console.log("viaInstance", viaInstance.constructor.alloc(2));
console.log("on the prototype itself", Writer.prototype.constructor.alloc(3));

// ── 5. an EXPLICIT back-link still shadows all of it ─────────────────
// This is how the shipped bundle spells writer_buffer.js, and it is an
// ordinary own member found by the walk long before the registry is asked.
function bufferWriterModule(Base) {
  function BufferWriter() {
    Base.call(this);
  }
  (BufferWriter.prototype = Object.create(Base.prototype)).constructor = BufferWriter;
  BufferWriter.alloc = function alloc(size) {
    return "node-buf(" + size + ")";
  };
  return [new BufferWriter(), BufferWriter];
}
var bw = bufferWriterModule(Writer);
console.log("bw finish", bw[0].push(5).finish());
console.log("bw ctor", bw[0].constructor === bw[1]);
console.log("bw instanceof", bw[0] instanceof Writer);
console.log("bw hasOwn", Object.hasOwn(bw[1].prototype, "constructor"));

// A third level whose own prototype was REPLACED and carries no explicit
// back-link: the walk goes past it to BufferWriter's, which is where Node
// finds it too.
function thirdModule(Base) {
  function Third() {
    Base.call(this);
  }
  Third.prototype = Object.create(Base.prototype);
  Third.alloc = function alloc(size) {
    return "third(" + size + ")";
  };
  return [new Third(), Third];
}
var th = thirdModule(bw[1]);
console.log("third ctor", th[0].constructor === bw[1], th[0].finish());

// The explicit back-link is a REFERENCE CYCLE — the prototype object holds
// a FUNC box holding the closure holding the table holding the prototype
// object — and it is the one this item could not create and did not. It is
// unlinked here so the program ends with a zero live-heap count under the
// RC audit; every read above already happened.
bw[1].prototype.constructor = null;

// ── 6. many constructors ─────────────────────────────────────────────
// The registry grows and rehashes; every entry stays findable, and the
// functions are all still reachable so every read answers.
function mk(i) {
  function K() {
    this.i = i;
  }
  K.tag = "K" + i;
  K.prototype.who = function who() {
    return this.constructor.tag + ":" + this.i;
  };
  return [new K(), K];
}
var pairs = [];
for (var i = 0; i < 300; i++) pairs.push(mk(i));
var ok = 0;
var idOk = 0;
for (var j = 0; j < pairs.length; j++) {
  if (pairs[j][0].who() === "K" + j + ":" + j) ok++;
  if (pairs[j][0].constructor === pairs[j][1]) idOk++;
}
console.log("registry", ok, idOk, pairs.length);

// ── 7. the plain literal is untouched ────────────────────────────────
// Nothing above put a `constructor` anywhere an object literal can see.
var plain = { a: 1 };
console.log("plain keys", Object.keys(plain).join(","));
console.log("plain hasOwn", Object.hasOwn(plain, "constructor"));

console.log("done");
