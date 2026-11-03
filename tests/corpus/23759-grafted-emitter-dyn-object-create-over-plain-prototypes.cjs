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
