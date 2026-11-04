"use strict";
// protobufjs-style generated message constructors (ES5 functions whose `prototype` receives defaults and accessors), in a program where a
// class expression evaluated inside a function also crosses into a dynamic value: the prototype writes of the constructors are exact.
function mkEvaluated(tag) {
  return class Evaluated {
    label() { return tag + ":" + this.n; }
    constructor(n) { this.n = n; }
  };
}
function gen(fields) {
  function Message(props) {
    if (props) for (var keys = Object.keys(props), i = 0; i < keys.length; ++i) if (props[keys[i]] != null) this[keys[i]] = props[keys[i]];
  }
  for (var i = 0; i < fields.length; ++i) Message.prototype[fields[i]] = null;
  Message.prototype.describe = function () { return "Message(" + Object.keys(this).join(",") + ")"; };
  Object.defineProperty(Message.prototype, "_first", { get: function () { return this[fields[0]]; } });
  return Message;
}
const A = gen(["product", "body"]);
const B = gen(["id"]);
B.prototype.extra = function () { return "extra" + this.id; };
const reg = { ev: mkEvaluated("ev"), msgA: A, msgB: B };
const E = reg.ev;
const a = new A({ body: "hello" });
const b = new B({ id: 7 });
console.log(a.product, a.body, a.describe(), a._first);
console.log(b.id, b.extra(), b.describe());
console.log(Object.keys(A.prototype), Object.keys(B.prototype));
console.log(new E(3).label(), typeof E, E.name);
console.log(a instanceof A, b instanceof A);
