"use strict";
// Object.getOwnPropertyDescriptor over every kind of value the checked-dynamic tree holds: the answer is Node's, key order included.
function repr(v) { return typeof v === "object" && v !== null ? "object" : typeof v === "function" ? "fn" : String(v); }
function show(label, o, k) {
  try {
    if (Object.getOwnPropertyDescriptor(o, k) === undefined) { console.log(label, "undefined"); return; }
    console.log(label, "value=" + repr(Object.getOwnPropertyDescriptor(o, k).value), "w=" + Object.getOwnPropertyDescriptor(o, k).writable,
      "e=" + Object.getOwnPropertyDescriptor(o, k).enumerable, "c=" + Object.getOwnPropertyDescriptor(o, k).configurable,
      "get=" + typeof Object.getOwnPropertyDescriptor(o, k).get, "set=" + typeof Object.getOwnPropertyDescriptor(o, k).set);
  } catch (e) { console.log(label, "throws", e.name + ": " + e.message); }
}
const plain = { a: 1, b: "s" };
Object.defineProperty(plain, "hid", { value: 7 });
Object.defineProperty(plain, "w", { value: 8, writable: true, configurable: true });
Object.defineProperty(plain, "acc", { get() { return 1; }, enumerable: true, configurable: true });
Object.defineProperty(plain, "acc2", { set(v) {}, configurable: false });
show("obj.a", plain, "a");
show("obj.hid", plain, "hid");
show("obj.w", plain, "w");
show("obj.acc", plain, "acc");
show("obj.acc2", plain, "acc2");
show("obj.missing", plain, "zz");
const arr = [10, , 30];
show("arr.0", arr, "0");
show("arr.1(hole)", arr, "1");
show("arr.length", arr, "length");
show("arr.9", arr, 9);
show("str.0", "héllo", "0");
show("str.length", "héllo", "length");
show("str.9", "héllo", "9");
const u8 = new Uint8Array([1, 2, 3]);
show("u8.0", u8, "0");
show("u8.length", u8, "length");
show("u8.5", u8, "5");
const buf = Buffer.from("hi");
show("buf.1", buf, "1");
show("buf.length", buf, "length");
function fn(a, b) {}
fn.own = 3;
show("fn.name", fn, "name");
show("fn.length", fn, "length");
show("fn.prototype", fn, "prototype");
show("fn.own", fn, "own");
show("fn.nope", fn, "nope");
class K { constructor() { this.f = 1; this.g = undefined; } m() {} get acc() { return 1; } static s() {} }
const k = new K();
show("inst.f", k, "f");
show("inst.g", k, "g");
show("inst.m", k, "m");
show("inst.acc", k, "acc");
show("class.s", K, "s");
show("class.name", K, "name");
show("class.prototype", K, "prototype");
show("map.size", new Map([[1, 2]]), "size");
show("set.size", new Set([1]), "size");
show("date.x", new Date(0), "x");
show("re.lastIndex", /a/g, "lastIndex");
show("re.source", /a/g, "source");
const err = new Error("boom");
show("err.message", err, "message");
show("err.name", err, "name");
show("promise.x", Promise.resolve(1), "x");
show("num", 5, "toFixed");
show("bool", true, "valueOf");
show("big", 10n, "x");
show("null", null, "x");
show("undefined", undefined, "x");
const s1 = Symbol("s1");
const withSym = { [s1]: 1 };
const target = { t: 1 };
const px = new Proxy(target, {});
show("proxy.t", px, "t");
const px2 = new Proxy(target, { getOwnPropertyDescriptor(t, key) { return { value: "trapped", configurable: true }; } });
show("proxy2.t", px2, "t");
show("globalThis.x", globalThis, "undefinedThing");
// Symbol keys on a dyn object (a static symbol key, an untyped key, a descriptor copied across).
const sk1 = Symbol("sk1");
const so = JSON.parse("{}");
so[sk1] = 5;
Object.defineProperty(so, Symbol.for("hid"), { value: 2, configurable: true });
function key(k) { return k; }
console.log(Object.getOwnPropertyDescriptor(so, sk1).value, Object.getOwnPropertyDescriptor(so, sk1).enumerable,
  Object.getOwnPropertyDescriptor(so, Symbol.for("hid")).enumerable, Object.getOwnPropertyDescriptor(so, Symbol("zz")));
function gone(obj, k) { return Object.getOwnPropertyDescriptor(obj, k) === undefined; }
console.log(gone(so, sk1), gone(so, "nope"), gone(so, key(Symbol.for("hid"))));
// a descriptor read and replayed on another object (the applyMixin shape)
const src = {};
Object.defineProperty(src, "acc", { get() { return 41; }, set(v) {}, enumerable: true, configurable: true });
const dst = {};
Object.defineProperty(dst, "acc", Object.getOwnPropertyDescriptor(src, "acc"));
console.log(dst.acc, Object.keys(dst));
