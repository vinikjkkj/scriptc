// `this` in a sloppy plain function is globalThis when the call's receiver is
// null or undefined: `call`, `apply`, `bind`, and a plain call all reach it. In
// strict code (a "use strict" function, a class method) the receiver stays null
// or undefined. The stand-in checked here is globalThis itself, so identity
// with it holds, and the nullish tests answer as they do in Node.

function who() {
  if (this === undefined) return "undef";
  if (this === null) return "null";
  if (this === globalThis) return "global";
  return "other";
}

console.log("call-null", who.call(null));
console.log("call-undef", who.call(undefined));
console.log("bind-null", who.bind(null)());
console.log("bind-undef", who.bind(undefined)());
console.log("apply-null", who.apply(null, []));
console.log("plain", who());
console.log("loose", who.call(null) == "global", who.call(null) != "global");

function typeOfThis() {
  return typeof this;
}
console.log("typeof", typeOfThis.call(null), typeOfThis.call(undefined));

function isNullish() {
  return [this == null, this === null, this === undefined, this !== globalThis];
}
console.log("nullish", isNullish.call(null).join(","));

function strictWho() {
  "use strict";
  if (this === undefined) return "undef";
  if (this === null) return "null";
  return "other";
}
console.log("strict-call", strictWho.call(null), strictWho.call(undefined));
console.log("strict-bind", strictWho.bind(null)(), strictWho.bind(undefined)());

const obj = {
  name: "o",
  m() {
    return this === globalThis ? "global" : this.name;
  },
};
const detached = obj.m;
console.log("obj-method", obj.m(), detached.call(null), detached.call(obj));
