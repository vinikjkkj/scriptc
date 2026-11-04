"use strict";
// Object.create(Base.prototype) chains over a base reached through a dynamic value (a module export, a parameter), with an evaluated class
// crossing into dyn in the same program: linking a child to a prototype object is exact, only a write into a class's prototype is refused.
function mkClass(n) { return class Evaluated { id() { return n; } }; }
function Base() { this.tag = "base"; }
Base.prototype.hello = function () { return "hello " + this.tag; };
const exportsLike = { Base: Base, Ev: mkClass(9) };
const Dyn = exportsLike.Base;
function Child() { Dyn.call(this); this.own = 1; }
(Child.prototype = Object.create(Dyn.prototype)).constructor = Child;
Child.prototype.more = function () { return this.hello() + "!" + this.own; };
function Other() { Dyn.call(this); }
Other.prototype = Object.create(Dyn.prototype, { extra: { value: function () { return "extra:" + this.tag; }, enumerable: false } });
const c = new Child(), o = new Other();
const E = exportsLike.Ev;
console.log(c.hello(), c.more(), o.hello(), o.extra());
console.log(c instanceof Base, o instanceof Base, Child.prototype.constructor === Child, new E().id());
console.log(Object.keys(Child.prototype), Object.keys(Other.prototype));
