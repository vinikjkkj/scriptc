"use strict";
// new Proxy over a literal target: the get, set, has and deleteProperty
// traps (arguments, receiver, `this` as the handler, the trap's answer
// decides), traps the handler does not carry run on the target, a falsish
// set/deleteProperty answer throws in strict code, a non-function trap is
// V8's TypeError, and a proxy over a non-object is rejected. The proxy
// bindings are the dynamic kind throughout. Node is the oracle.
const show = (fn) => {
  try {
    console.log("ok", fn());
  } catch (e) {
    console.log(`${e.name}|${e.message}`);
  }
};

/** @type {any} */
const notObject = 1;
show(() => new Proxy(notObject, {}));
show(() => new Proxy({}, notObject));
show(() => {
  const p = new Proxy(/** @type {any} */ ({}), { get: notObject });
  return p.x;
});

const log = [];
const p = new Proxy(/** @type {any} */ ({ a: 1 }), {
  marker: "H",
  get(t, k, r) {
    log.push("get " + String(k) + " this=" + this.marker + " receiver=" + (r === p));
    return k in t ? t[k] : "dflt";
  },
  set(t, k, v, r) {
    log.push("set " + String(k) + "=" + v + " receiver=" + (r === p));
    t[k] = v;
    return true;
  },
  has(t, k) {
    log.push("has " + String(k));
    return k in t;
  },
  deleteProperty(t, k) {
    log.push("delete " + String(k));
    delete t[k];
    return true;
  },
});
console.log(p.a, p.zzz, p["a"]);
p.b = 2;
p["c"] = 3;
console.log("b" in p, "q" in p, delete p.b, "b" in p);
console.log(log.join("\n"));

show(() => {
  const q = new Proxy(/** @type {any} */ ({}), { set() { return false; } });
  q.x = 1;
});
show(() => {
  const q = new Proxy(/** @type {any} */ ({}), { deleteProperty() { return false; } });
  return delete q.x;
});
show(() => {
  const q = new Proxy(/** @type {any} */ ({ a: 1 }), {});
  q.b = 2;
  return [q.a, q.b, "a" in q, "z" in q, delete q.a, "a" in q];
});
show(() => {
  const q = new Proxy(/** @type {any} */ ({ a: 1 }), { has(t, k) { return k === "magic"; } });
  return ["magic" in q, "a" in q];
});
show(() => typeof new Proxy(function () {}, {}) + typeof new Proxy({}, {}) + typeof new Proxy([], {}));
