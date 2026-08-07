// `new` and `instanceof` over dyn function values — the two operators
// that READ the prototype chain 2762 builds, and the four places where
// answering instead of throwing is a silent wrong answer.
//
// JavaScript's `instanceof` is not a predicate that always answers. Its
// spec (OrdinaryHasInstance) interleaves three TypeErrors with the
// answer, and their ORDER is observable:
//
//   1. right operand not an object     → "…is not an object"
//   2. right operand not callable      → "…is not callable"
//   3. LEFT operand not an object      → false, and nothing further is
//      asked — `7 instanceof F` is false even when F.prototype is 5,
//      which step 4 would otherwise throw about
//   4. right operand's `prototype` not an object
//                                      → "Function has non-object
//                                         prototype 'X' in instanceof
//                                         check"
//
// A program writes `x instanceof C` precisely when it does not know what
// x and C are, so answering `false` to all four — one bad `C` away from
// a branch silently taken backwards — is the worst available answer.
//
// `new` has one rule of its own that nothing else expresses: the
// constructor's RETURN. An object result replaces the fresh instance; a
// primitive result is discarded and the instance survives. Both halves
// are here, because a runtime that gets the second one wrong returns 7
// from `new` and every field read after it throws.
//
// A JavaScript entry, like the chain it reads: in TypeScript the checker
// has a declared type at each of these sites and the typed lowerings
// claim them first.

"use strict";

// An untyped parameter is a dyn slot, which is what makes the right
// operand a RUNTIME question — the whole point of the operator. Every
// call below hands it something different.
function check(o, C) {
  try {
    return String(o instanceof C);
  } catch (e) {
    return e.name + ": " + e.message;
  }
}

function Klass(a) {
  this.a = a;
}
Klass.prototype.get = function () {
  return this.a;
};

const k = new Klass(1);

// The answering cases, both directions.
console.log(check(k, Klass));
console.log(check({}, Klass));

// Step 1 — a right operand that is not an object at all.
console.log(check(k, 5));
console.log(check(k, "s"));
console.log(check(k, true));
console.log(check(k, null));
console.log(check(k, undefined));

// Step 2 — an object that is not callable. Distinct message.
console.log(check(k, {}));
console.log(check(k, [1, 2]));

// Step 3 — a primitive LEFT operand is false, never a throw.
console.log(check(7, Klass));
console.log(check(null, Klass));
console.log(check(undefined, Klass));
console.log(check("s", Klass));

// ── the constructor's return value ──────────────────────────────────
// An object result REPLACES the instance.
function ReturnsObject() {
  this.discarded = true;
  return { kept: 1 };
}
const ro = new ReturnsObject();
console.log(ro.kept, ro.discarded);

// A primitive result is DISCARDED and the instance survives — every
// kind of primitive, because "is it an object" is the whole test.
function ReturnsNumber() {
  this.n = 1;
  return 7;
}
function ReturnsString() {
  this.n = 2;
  return "x";
}
function ReturnsNull() {
  this.n = 3;
  return null;
}
function ReturnsUndefined() {
  this.n = 4;
  return undefined;
}
function ReturnsNothing() {
  this.n = 5;
}
console.log(new ReturnsNumber().n);
console.log(new ReturnsString().n);
console.log(new ReturnsNull().n);
console.log(new ReturnsUndefined().n);
console.log(new ReturnsNothing().n);

// An array result is an OBJECT, so it replaces too.
function ReturnsArray() {
  this.discarded = true;
  return [9];
}
console.log(new ReturnsArray()[0]);

// A returned object is NOT an instance — it never got the link.
console.log(check(new ReturnsObject(), ReturnsObject));
console.log(check(new ReturnsNumber(), ReturnsNumber));

// `new` on something that is not a function names the callee.
function construct(C) {
  try {
    return String(new C().x);
  } catch (e) {
    return e.name + ": " + e.message;
  }
}
console.log(construct(5));
console.log(construct({}));
console.log(construct(null));

// ── the `prototype` a function value carries ────────────────────────
// Replacing it wholesale is a plain writable-property assignment in JS
// (`prototype` on a function declaration is writable), and it is how
// every pre-class program spells inheritance and namespacing.
function Replaced() {
  this.v = 1;
}
const shared = { tag: "shared" };
Replaced.prototype = shared;
const rp = new Replaced();
console.log(rp.v, rp.tag);
console.log(check(rp, Replaced));

// Identity, not shape: a second function with the very same prototype
// OBJECT does answer true, and one with an equal-looking other object
// does not.
function AlsoReplaced() {}
AlsoReplaced.prototype = shared;
function LooksSame() {}
LooksSame.prototype = { tag: "shared" };
console.log(check(rp, AlsoReplaced));
console.log(check(rp, LooksSame));

// Reassigning after an instance exists does not retro-link it: the
// instance keeps the object it was built with, and the operator reads
// the CURRENT one.
Replaced.prototype = { tag: "other" };
console.log(rp.tag);
console.log(check(rp, Replaced));

// Step 4 — a `prototype` that is not an object. Reachable only through
// the replacement above, and it throws rather than answering.
function BadProto() {
  this.v = 1;
}
BadProto.prototype = 5;
console.log(check(k, BadProto));
BadProto.prototype = null;
console.log(check(k, BadProto));
BadProto.prototype = undefined;
console.log(check(k, BadProto));
// …but a primitive left operand still short-circuits to false ahead of
// it (step 3 before step 4).
console.log(check(7, BadProto));

// A non-object `prototype` is IGNORED by `new`, which falls back to
// %Object.prototype% — the instance is a plain object, and inspect
// prints it without a constructor name because the name rode the
// prototype that was replaced.
BadProto.prototype = 5;
const bp = new BadProto();
console.log(bp.v, bp.tag);
console.log(JSON.stringify(bp));

// ── the end of the chain ────────────────────────────────────────────
// A null-prototype prototype object: reads walk one link and STOP.
// Nothing is inherited past it (no toString, no hasOwnProperty), which
// is exactly what Object.create(null) is chosen for.
function Dict(key) {
  this.key = key;
}
Dict.prototype = Object.create(null);
Dict.prototype.marker = "dict";
const d = new Dict("k");
console.log(d.key, d.marker, d.absent);
console.log(check(d, Dict));
console.log(JSON.stringify(d));
console.log(Object.keys(d).join(","));

// The chain is walked for READS only — a write SHADOWS, it does not
// reach through, and the other instance still sees the inherited value.
const d2 = new Dict("k2");
d.marker = "own";
console.log(d.marker, d2.marker);
console.log(Object.keys(d).join(","));

// ── a chain longer than one link ────────────────────────────────────
// `Child.prototype = Object.create(Parent.prototype)` is how JavaScript
// spelled inheritance for twenty years, and it is the only thing that
// gives `instanceof` a chain to WALK rather than one link to compare.
// A Child instance is an instance of both, a Parent instance of only
// one, and the method the child overrides is found before the parent's
// because the walk stops at the first hit.
function Animal(name) {
  this.name = name;
}
Animal.prototype.speak = function () {
  return this.name + " makes " + this.sound();
};
Animal.prototype.sound = function () {
  return "a noise";
};
Animal.prototype.legs = 4;

// (`Animal.call(this, name)` is how a real program chains to the parent
// constructor; Function.prototype.call over a function VALUE has no
// lowering yet, so this spells the field directly � see the report.)
function Dog(name) {
  this.name = name;
}
Dog.prototype = Object.create(Animal.prototype);
Dog.prototype.sound = function () {
  return "a bark";
};

function Puppy(name) {
  this.name = name;
}
Puppy.prototype = Object.create(Dog.prototype);

const dog = new Dog("rex");
const pup = new Puppy("bit");
const any = new Animal("gen");

// Three links up: the inherited method calls the OVERRIDDEN one through
// `this`, from two levels below where it was written.
console.log(dog.speak());
console.log(pup.speak());
console.log(any.speak());

// A plain data member found three links up.
console.log(pup.legs, pup.nothing);

// The walk, at every depth and in both directions.
console.log(check(pup, Puppy), check(pup, Dog), check(pup, Animal));
console.log(check(dog, Puppy), check(dog, Dog), check(dog, Animal));
console.log(check(any, Puppy), check(any, Dog), check(any, Animal));

// Delegation is LIVE: a member added to the top of the chain after
// every instance was built still reads through all three links.
Animal.prototype.later = "added-after";
console.log(pup.later, dog.later, any.later);

// …and the created objects have no own keys of their own, which is the
// half an own-property copy could never have gotten right.
console.log(Object.keys(pup).join(","), JSON.stringify(pup));
console.log(Object.keys(Dog.prototype).join(","));

// A primitive prototype is not an object, and Object.create says so.
function create(p) {
  try {
    return String(Object.create(p).x);
  } catch (e) {
    return e.name + ": " + e.message;
  }
}
console.log(create(5));
console.log(create("s"));
console.log(create(true));
console.log(create(undefined));
