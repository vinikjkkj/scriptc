// The `constructor` back-link, written EXPLICITLY, and the ring it makes.
//
// `F.prototype.constructor = F` is the oldest idiom in JavaScript — the
// half of `util.inherits` every pre-class library ends with, and a line
// `pbjs --target static-module` emits for every message type. It is also
// a reference CYCLE in a refcounted runtime, and a cycle that passes
// through a place refcounting alone can never reach:
//
//   the closure F  ->  its own-property table (ScrClosure.props)
//                  ->  that table's `prototype` member
//                  ->  the minted prototype OBJECT
//                  ->  its `constructor` member (a FUNC dyn)
//                  ->  the closure F
//
// Every edge in that ring is traced by the cycle collector. What was NOT
// traced was a SECOND, parallel edge — `ScrClosure.implicit_proto`, the
// closure's own +1 on the prototype it minted — and an untraced edge into
// a node the collector is trial-deleting does not merely fail to be
// followed: it leaves an un-decremented reference behind. markGray took
// the prototype's count down for the props-table edge and not for this
// one, `scan` read the surviving rc > 0 as "externally referenced", and
// `scanBlack` restored the WHOLE subgraph. So the ring above was not
// merely left uncollected, it was uncollectABLE — for as long as a
// function's prototype has been an object at all.
//
// Nothing about that is visible in output: a leak prints nothing. It is
// visible in exactly one place, the RC audit (`SCRIPTC_RC_AUDIT=1`, which
// turns the whole-corpus differential into a leak suite), where this
// program's ancestor `2762-prototype-chain.js` had been failing with
// "1 box(es), 2 closure(s), 4 dyn value(s) live at exit" unnoticed,
// because nothing gates that lane.
//
// So this program is deliberately boring on stdout and loud in the audit.
// Its assertions are ordinary JS semantics — the back-link reads back and
// constructs, it is found through an instance, a shadowing instance
// member does not disturb it, two factory calls make two independent
// rings — and every one of them holds identically whether or not the ring
// is ever collected. The FIXTURE is that it also exits 0 under the audit.
//
// Identity is spelled `instanceof` and `typeof` throughout rather than
// `===`: on `any`-typed values `===` is an SC2011 refusal (it needs the
// embedded dynamic engine), and a corpus program must not raise the
// refusal census to make a point about memory.
//
// A JavaScript entry, like the program it derives from: in TypeScript the
// checker has a declared member type at each of these accesses, so the
// JS-gated inference route is the one that reaches this shape.

"use strict";

// 1 — the ring itself, minted inside a factory so the closure is not a
// top-level interned (immortal) function value. An immortal closure is
// torn down by scr_closure_static_teardown and never reaches the
// collector at all, so a top-level `function F() {}` would prove nothing
// about the cycle.
function makeNode(tag) {
  function Node(v) {
    this.tag = tag;
    this.v = v;
  }
  // The back-link. This is the whole subject.
  Node.prototype.constructor = Node;
  Node.prototype.describe = function () {
    return this.tag + "/" + this.v + "/" + typeof this.constructor;
  };
  return Node;
}

const A = makeNode("a");
const B = makeNode("b");

// The back-link reads back as a function, and CONSTRUCTS — which is the
// only way to show it is the same function without `===`.
const ctorA = A.prototype.constructor;
console.log(typeof ctorA);
const viaBackLink = new ctorA(1);
console.log(viaBackLink.describe());
console.log(viaBackLink instanceof A, viaBackLink instanceof B);

// …and the same one link up, through an INSTANCE.
const a1 = new A(1);
const ctorOfA1 = a1.constructor;
console.log(typeof ctorOfA1, new ctorOfA1(7).describe());
console.log(a1 instanceof A, a1 instanceof B);

// It is an OWN member of the prototype object and an inherited one of the
// instance — `in` walks the chain, Object.hasOwn does not.
console.log(Object.hasOwn(A.prototype, "constructor"), Object.hasOwn(a1, "constructor"));
console.log("constructor" in a1, "describe" in a1, "nope" in a1);
// NOT Object.keys(A.prototype): an explicitly assigned `constructor` is a
// [[Set]] on the non-enumerable own property the function declaration
// already created, so Node keeps enumerable:false and lists only
// `describe` where this compiler lists both. That divergence is real, is
// older than this program, and is a property-attribute question rather
// than a memory one -- pinning it here would only make a leak fixture
// fail for an unrelated reason. Object.hasOwn answers the own-ness
// question this program actually cares about, and both sides agree.
console.log(Object.hasOwn(A.prototype, "describe"), Object.hasOwn(A.prototype, "nope"));

// A method that reads the back-link through `this`.
console.log(a1.describe(), new B(2).describe());

// Two factory calls are two rings, not one shared one: an instance of one
// is not an instance of the other, and each prototype's back-link builds
// its own tag.
const fromB = new B.prototype.constructor(5);
console.log(fromB.describe(), fromB instanceof B, fromB instanceof A);

// A shadowing own member on the instance does not disturb the prototype's.
const a2 = new A(3);
a2.constructor = "shadowed";
console.log(a2.constructor, typeof a1.constructor, typeof A.prototype.constructor);
console.log(Object.hasOwn(a2, "constructor"), Object.keys(a2).join(","));
console.log(JSON.stringify(a2));

// 2 — the ring reached the other way round: a STATIC that captures the
// constructor, which is the props-table half of the same cycle. Both
// halves in one program, because the fix is one edge and it has to hold
// for both.
function makeCounted() {
  let made = 0;
  function Counted() {
    made += 1;
    this.n = made;
  }
  Counted.prototype.constructor = Counted;
  // Captures `Counted`: closure -> props -> table -> FUNC dyn -> closure.
  Counted.create = function () {
    return new Counted();
  };
  Counted.made = function () {
    return made;
  };
  return Counted;
}

const C = makeCounted();
console.log(C.create().n, C.create().n, C.made());
console.log(C.create() instanceof C, typeof C.prototype.constructor);

// 3 — rings made and DROPPED mid-run, so the collector has to reclaim
// them while the program is still running rather than only at exit.
// Nothing here is observable except that the loop's values are right; the
// point is the population the audit counts afterwards.
let last = "";
for (let i = 0; i < 40; i++) {
  const K = makeNode("k" + i);
  const inst = new K(i);
  last = inst.describe();
}
console.log(last);

// 4 — a two-object ring: each prototype's member is a function returning
// the OTHER constructor, and each carries its own back-link. A ring the
// walk has to follow two objects deep before it closes.
function makePair() {
  function Outer() {
    this.side = "outer";
  }
  function Inner() {
    this.side = "inner";
  }
  Inner.prototype.constructor = Inner;
  Inner.prototype.other = function () {
    return Outer;
  };
  Outer.prototype.constructor = Outer;
  Outer.prototype.other = function () {
    return Inner;
  };
  return Outer;
}
const O = makePair();
const o = new O();
console.log(o.side, typeof o.constructor, typeof o.other());
const I = o.other();
const i2 = new I();
console.log(i2.side, i2 instanceof I, i2 instanceof O);
console.log(new (i2.other())().side);

// 5 — the prototype object escaping its function. The registry that
// answers a NON-assigned `constructor` keys on this object's address and
// holds a borrowed closure pointer, so an escaped prototype whose
// function is otherwise unreferenced is exactly the case where erasing
// the entry at teardown has to happen — and it has to happen whether the
// closure went by refcount or through the collector.
function escapedProto() {
  function E() {}
  E.prototype.mark = "escaped";
  return E.prototype;
}
const ep = escapedProto();
console.log(ep.mark, Object.keys(ep).join(","));

console.log("done");
