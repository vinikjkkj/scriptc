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
