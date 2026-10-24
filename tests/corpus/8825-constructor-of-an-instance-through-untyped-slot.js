// `x.constructor` on a class instance that reached an untyped slot is the
// instance's class value: its name, identity, statics (fields, methods,
// getters, a write), inherited statics, `new` through it, and the TypeError
// for calling it without `new`. Each was "a property read on a dynamic X is
// not supported yet" (or SC2020 for a typed receiver). A builtin error's
// constructor is its kind's class value.
'use strict';

class Base {
  static count = 0;
  static tag = "base";
  static make() { return new Base(); }
  static twice(n) { return n * 2; }
  static get label() { return "L:" + Base.tag; }
  constructor() { this.id = ++Base.count; }
}
class Derived extends Base {
  static extra = "x";
  static who() { return "derived"; }
  constructor() { super(); this.kind = "d"; }
}
class Plain { constructor() { this.q = 1; } }

function t(name, f) {
  try { console.log(name, f()); } catch (e) { console.log(name, "THROW", e.name, e.message); }
}
function ctorOf(x) { return x.constructor; }

const b = new Base(), d = new Derived(), p = new Plain();
t("name", () => ctorOf(b).name + "," + ctorOf(d).name + "," + ctorOf(p).name);
t("typeof", () => typeof ctorOf(b));
t("identity", () => (ctorOf(b) === ctorOf(new Base())) + "," + (ctorOf(b) === ctorOf(d)));
t("static field", () => ctorOf(b).tag + "," + ctorOf(d).tag + "," + ctorOf(d).extra);
t("static method", () => ctorOf(b).twice(21) + "," + ctorOf(d).twice(4) + "," + ctorOf(d).who());
t("static getter", () => ctorOf(b).label);
t("static write", () => { ctorOf(b).tag = "changed"; return Base.tag + "|" + ctorOf(d).tag + "|" + ctorOf(b).label; });
t("static counter", () => ctorOf(b).count);
t("method value", () => { const f = ctorOf(b).twice; return typeof f + f(5); });
t("new through it", () => { const C = ctorOf(d); const o = new C(); return o.kind + "," + o.id + "," + (ctorOf(o) === C); });
t("static factory", () => ctorOf(b).make().id);
t("call without new", () => ctorOf(b)());
t("absent static", () => ctorOf(b).nope);
t("typed receiver", () => new Derived().constructor.name + "," + (new Plain().constructor === new Plain().constructor));
t("typed receiver static", () => new Derived().constructor.who());

console.log("--- builtin errors");
function errCtor(e) { return e.constructor; }
t("error name", () => errCtor(new Error("a")).name + "," + errCtor(new TypeError("b")).name + "," + errCtor(new RangeError("c")).name);
t("error identity", () => (errCtor(new Error("a")) === errCtor(new Error("b"))) + "," + (errCtor(new Error("a")) === errCtor(new TypeError("b"))));
t("error typeof", () => typeof errCtor(new Error("a")));
t("new through error ctor", () => { const C = errCtor(new RangeError("x")); const e = new C("made"); return e.name + ":" + e.message; });
t("call error ctor", () => { const C = errCtor(new TypeError("x")); const e = C("called"); return e.name + ":" + e.message; });
