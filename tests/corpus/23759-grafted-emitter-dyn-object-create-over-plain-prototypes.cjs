const { EventEmitter } = require("events");
function applyMixin(derivedConstructor, mixinConstructor) {
  Object.getOwnPropertyNames(mixinConstructor.prototype).forEach((name) => {
    Object.defineProperty(derivedConstructor.prototype, name, Object.getOwnPropertyDescriptor(mixinConstructor.prototype, name));
  });
}
// Object.create over a prototype built in the program (an object literal held in a local, the protobuf enum-table idiom
// `(e = {}, t = Object.create(e), t[e[0] = "ONE"] = 0)`) is no prototype link over a grafted instance, so a program that
// also boxes one still compiles and answers exactly.
class Redis { constructor() { this.a = 1; EventEmitter.call(this); } }
applyMixin(Redis, EventEmitter);
const v = (x) => x;
function table() {
  var e = {}, t;
  t = Object.create(e);
  t[e[0] = "ONE"] = 0;
  t[e[1] = "TWO"] = 1;
  var e2 = {};
  var t2 = Object.create(e2);
  return [Object.keys(t).join(","), Object.keys(e).join(","), Object.keys(t2).length, t.ONE, e[1]];
}
console.log(table().join("|"), Object.keys(v(new Redis())).join(","));
// protobufjs's error-class idiom: Object.create(Error.prototype, { ...descriptors }), and a null-prototype object. The
// prototype is a built-in, so it is no link over a grafted instance either.
function make(label) {
  function T(m) { this.m = m; }
  T.prototype = Object.create(Error.prototype, {
    constructor: { value: T, writable: true, enumerable: false, configurable: true },
    name: { get: function () { return label; }, set: undefined, enumerable: false, configurable: true },
    toString: { value: function () { return this.name + ": " + this.m; }, writable: true, enumerable: false, configurable: true },
  });
  return T;
}
const E = make("MyErr");
const err = new E("boom");
console.log(String(err), err instanceof Error, err.name, Object.keys(err).join(","));
const bare = Object.create(null);
bare.x = 1;
console.log(Object.keys(bare).join(","));
// The ES5 inheritance idiom: Object.create(Base.prototype) links to a prototype object, never to an instance.
function inherit(Base) {
  function Child() { Base.call(this); this.c = 2; }
  Child.prototype = Object.create(Base.prototype);
  Child.prototype.constructor = Child;
  return Child;
}
function Parent() { this.p = 1; }
Parent.prototype.hello = function () { return "hi " + this.p + this.c; };
const Kid = inherit(Parent);
const kid = new Kid();
console.log(kid.hello(), kid instanceof Parent, Object.keys(kid).join(","));
// The generated protobuf enum idiom, in many functions that reuse the same local names (some of them parameters): each
// `var e = {}, t = Object.create(e)` is judged in its own function.
function other(e, t) { return e + t; }
const enums = {};
enums.One = (function () { var e = {}, t = Object.create(e); return t[e[0] = "A"] = 0, t[e[1] = "B"] = 1, t; })();
enums.Two = (function () { var e = {}, t = Object.create(e); return t[e[0] = "C"] = 0, t; })();
console.log(Object.keys(enums.One).join(","), Object.keys(enums.Two).join(","), other(1, 2), Object.keys(v(new Redis())).join(","));
