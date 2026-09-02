// A class instance in a dyn slot keeps its members.
//
// This program is the repro for a MATCH->WRONG that lived in main: a
// DECLARED class crossing into an untyped parameter lost its methods, and
// `x.get()` answered Node's "x.get is not a function" for a method the
// object plainly has. The methods were never dropped -- a class's methods
// are static functions in the emitted TU, and nothing the SCR_DYN_OBJINST
// box carried could name one.
//
// Six questions degraded at the crossing, and TWO of them silently: `in`
// answered false and Object.keys answered nothing, both at exit 0. Every
// line below is one of them, plus the reach shapes that decide whether a
// value crosses at all. The prototype-constructor spelling of the same
// JavaScript answered all of it correctly the whole time, so the last
// block is that spelling beside this one: the two must agree.
class Box {
  constructor(v) {
    this.v = v;
  }
  get() {
    return this.v;
  }
  inc() {
    this.v = this.v + 1;
    return this;
  }
  toString() {
    return "Box(" + String(this.v) + ")";
  }
}

// The crossing itself: an untyped parameter is a dyn slot.
function use(x) {
  return x.get();
}
console.log(String(use(new Box(7))));

// The reach shapes. Each one puts the instance in a dyn slot by a
// different route, and each was its own wrong answer.
const arrow = (x) => x.get();
console.log(String(arrow(new Box(1))));
function fromArray(xs) {
  return xs[0].get();
}
console.log(String(fromArray([new Box(2)])));
function fromField(r) {
  return r.b.get();
}
console.log(String(fromField({ b: new Box(3) })));
function fromRest(...xs) {
  return xs[0].get();
}
console.log(String(fromRest(new Box(4))));
function fromDestructured({ b }) {
  return b.get();
}
console.log(String(fromDestructured({ b: new Box(5) })));
function capture(x) {
  return function () {
    return x.get();
  };
}
console.log(String(capture(new Box(6))()));
class Holder {
  take(x) {
    return x.get();
  }
}
console.log(String(new Holder().take(new Box(8))));

// A ROUND TRIP: into dyn and back out to a typed binding.
function pass(x) {
  return x;
}
const round = pass(new Box(9));
console.log(String(round.get()));
console.log(String(round.v));

// The six degraded questions, on one instance.
function surface(x) {
  return [
    String(x.v),
    typeof x.get,
    String("get" in x),
    String("v" in x),
    String("nope" in x),
    Object.keys(x).join("|"),
    JSON.stringify(x),
    String(x),
  ].join(",");
}
console.log(surface(new Box(10)));

// A method read as a VALUE and called back: the read and the call must be
// one answer, not two.
function asValue(x) {
  const m = x.get;
  return m.call(x);
}
console.log(String(asValue(new Box(11))));

// A chaining method that rewrites a constructor-initialised field.
function chain(x) {
  return x.inc().get();
}
console.log(String(chain(new Box(12))));

// A computed key.
function computed(x, k) {
  return x[k]();
}
console.log(String(computed(new Box(13), "get")));

// INHERITED and OVERRIDDEN methods dispatch on what the object IS, never
// on the declared type of a slot it passed through.
class Base {
  constructor(v) {
    this.v = v;
  }
  get() {
    return this.v;
  }
  who() {
    return "base";
  }
}
class Derived extends Base {
  who() {
    return "derived";
  }
}
function bothWays(x) {
  return String(x.get()) + ":" + x.who();
}
console.log(bothWays(new Base(14)));
console.log(bothWays(new Derived(15)));

// A GETTER runs; two distinct classes behind ONE parameter each answer
// their own method.
class Gauge {
  constructor(v) {
    this.v = v;
  }
  get doubled() {
    return this.v * 2;
  }
}
function readAccessor(x) {
  return x.doubled;
}
console.log(String(readAccessor(new Gauge(16))));
class A {
  m() {
    return "a";
  }
}
class B {
  m() {
    return "b";
  }
}
function callM(x) {
  return x.m();
}
console.log(callM(new A()) + callM(new B()));

// A method taking arguments, including a missing one (JS arity: an
// omitted argument IS undefined).
class Adder {
  constructor(v) {
    this.v = v;
  }
  plus(a, b) {
    return this.v + a + (b === undefined ? 0 : b);
  }
}
function addThrough(x) {
  return String(x.plus(1, 2)) + "/" + String(x.plus(1));
}
console.log(addThrough(new Adder(17)));

// The PROTOTYPE spelling of the same questions, which answered correctly
// before any of this existed. The two spellings must agree.
function PBox(v) {
  this.v = v;
}
PBox.prototype.get = function () {
  return this.v;
};
PBox.prototype.toString = function () {
  return "Box(" + String(this.v) + ")";
};
console.log(surface(new PBox(10)));
