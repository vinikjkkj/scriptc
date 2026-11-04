"use strict";
// util.inherits-style helper (the Node implementation, which has no lowering of its own) and Object.create(Base.prototype) chains on ES5
// constructors, next to an evaluated class that crosses into dyn.
function inherits(ctor, superCtor) {
  ctor.super_ = superCtor;
  ctor.prototype = Object.create(superCtor.prototype, { constructor: { value: ctor, enumerable: false, writable: true, configurable: true } });
}
function Base(name) { this.name = name; }
Base.prototype.hello = function () { return "hello " + this.name; };
function Derived(name, extra) { Base.call(this, name); this.extra = extra; }
inherits(Derived, Base);
Derived.prototype.both = function () { return this.hello() + "+" + this.extra; };
function Third(name) { Base.call(this, name); }
Third.prototype = Object.create(Base.prototype);
Third.prototype.constructor = Third;
Third.prototype.third = function () { return "third " + this.name; };
function make(k) { return class Made { who() { return "made" + k; } }; }
const holder = { cls: make(1), d: Derived, t: Third };
const M = holder.cls;
const d = new Derived("x", 2), t = new Third("y");
console.log(d.hello(), d.both(), t.hello(), t.third());
console.log(d instanceof Base, t instanceof Base, Derived.super_ === Base);
console.log(new M().who(), typeof holder.cls);
