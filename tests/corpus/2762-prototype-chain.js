// The prototype chain: JavaScript's pre-class object model, and the shape
// `pbjs --target static-module` emits for every message type it generates
// — a constructor function, methods hung off its `prototype`, `new` to
// make an instance, and dispatch that reads `this`.
//
// Four things have to hold together or none of them is worth anything:
//
//   1. `K.prototype` is an OBJECT and it is the SAME object every time.
//      It has to exist before anything is written to it (JS creates it
//      with the function declaration), and it has to live on the CLOSURE
//      like every other own property, so two boxes of one function value
//      see one prototype and two function values from two calls of one
//      factory see two.
//   2. `new K(a)` links the fresh instance to that object and binds it as
//      the constructor's receiver, so `this.a = a` lands on the instance.
//   3. A READ that misses the instance's own members continues up the
//      chain — but only the reads JS says walk it. Object.keys, hasOwn,
//      JSON.stringify and the keyed WRITE are own-only, and a write
//      SHADOWS rather than mutating the prototype.
//   4. `instanceof` reads the link back, by object identity.
//
// A JavaScript entry on purpose: the route is JS-gated like the
// own-property route it completes, because in TypeScript the checker has
// a declared member type at every one of these accesses.

"use strict";

/** @param {string} tag */
function makeWriter(tag) {
  function Writer(seed) {
    this.tag = tag;
    this.buf = [seed];
  }
  // The whole idiom: methods written onto the prototype object, which
  // nothing created explicitly. Every one of them reads `this`.
  Writer.prototype.push = function (n) {
    this.buf.push(n);
    return this;
  };
  Writer.prototype.finish = function () {
    return this.tag + ":" + this.buf.join("-");
  };
  // A non-function prototype member — inherited data, not just methods.
  Writer.prototype.kind = "writer";
  // A STATIC alongside the prototype members: the flat own-property half
  // and the chain half of pbjs's API on one function value.
  Writer.create = function (seed) {
    return new Writer(seed);
  };
  return Writer;
}

const A = makeWriter("a");
const B = makeWriter("b");

// Construction, receiver binding, chained prototype dispatch.
const w = new A(1);
console.log(w.push(2).push(3).finish());

// `new` reached through a static that closes over the same function value.
console.log(A.create(9).push(8).finish());

// Two function values from two calls of one factory have two prototypes.
console.log(new B(1).finish(), new A(1).finish());

// An INHERITED data member, and an own write that SHADOWS it without
// touching the prototype the other instance still reads.
const s1 = new A(0);
const s2 = new A(0);
console.log(s1.kind, s2.kind);
s1.kind = "shadowed";
console.log(s1.kind, s2.kind);

// Which reads walk the chain and which do not. `in` walks; Object.hasOwn,
// Object.keys and JSON.stringify are own-only; a missing key anywhere in
// the chain is undefined, not an error.
console.log("kind" in s2, "push" in s2, "nope" in s2);
console.log(Object.hasOwn(s2, "kind"), Object.hasOwn(s2, "buf"));
console.log(Object.keys(s2).join(","));
console.log(Object.keys(A.prototype).join(","));
console.log(JSON.stringify(s2));
console.log(s2.nope);

// The prototype object is one object, reachable by two spellings, and the
// members written through one are visible through the other.
const protoA = A.prototype;
protoA.late = "added-after-instances-existed";
console.log(w.late, s1.late);

// util.inspect prints the constructor's name for an instance and nothing
// for a plain object — the one place the chain is observable in output.
console.log(new B(4));
console.log({ plain: true });

// instanceof, by object identity: an instance of the other factory's
// function is NOT an instance of this one even though the two were built
// from the same source text, and a plain parsed object is neither.
const ia = new A(1);
const ib = new B(1);
console.log(ia instanceof A, ia instanceof B, ib instanceof B, ib instanceof A);
console.log(JSON.parse('{"a":1}') instanceof A);

// A constructor that RETURNS an object: JS's [[Construct]] keeps the
// returned object and drops the fresh one; a non-object return is
// discarded and the instance survives.
function makeOdd() {
  function Replaced() {
    this.ignored = true;
    return { replaced: true };
  }
  function Scalar() {
    this.kept = true;
    return 42;
  }
  return [Replaced, Scalar];
}
const pair = makeOdd();
const Replaced = pair[0];
const Scalar = pair[1];
console.log(JSON.stringify(new Replaced()), JSON.stringify(new Scalar()));

// An explicitly assigned `constructor` back-link is a plain own member of
// the prototype object and reads back exactly, through an instance too.
function makeNamed() {
  function Named() {}
  Named.prototype.constructor = Named;
  Named.prototype.self = function () {
    return typeof this.constructor;
  };
  return Named;
}
const Named = makeNamed();
console.log(new Named().self());
