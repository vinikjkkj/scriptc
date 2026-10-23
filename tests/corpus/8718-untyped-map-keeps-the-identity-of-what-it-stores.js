// A value stored in a JavaScript Map or Set is the SAME object: a later
// mutation is visible through the container, `===` holds both ways, and a
// key found by identity is found again. The dyn container used to store a
// COPY of a record or array bound to a local (the static record and the dyn
// object are different memory), so `m.get("a").n` answered the stale value
// where Node answers the mutated one. A binding initialized by an object or
// array literal that is handed to an untyped container is now the dyn value
// itself, one identity shared by both; a record that cannot be aliased is
// refused at build time rather than stored as a copy.
'use strict';

function mk() { return new Map(); }
function same(a, b) { return a === b; }
function mks() { return new Set(); }
class Box { constructor(v) { this.v = v; } }

function values() {
  const m = mk();
  const r = { n: 1 };
  const arr = [1];
  const box = new Box(10);
  const fn = () => 7;
  const inner = mk();
  m.set("r", r); m.set("arr", arr); m.set("box", box); m.set("fn", fn); m.set("inner", inner);
  r.n = 2; arr.push(2); box.v = 11; inner.set("k", "v");
  console.log(r.n, m.get("r").n, m.get("r") === r);
  console.log(arr.length, m.get("arr").length, m.get("arr") === arr);
  console.log(box.v, m.get("box").v, same(m.get("box"), box));
  console.log(same(m.get("fn"), fn), m.get("fn")());
  console.log(m.get("inner") === inner, m.get("inner").get("k"), m.size);
  m.get("r").n = 3; m.get("arr").push(3);
  console.log(r.n, arr.length);
  for (const [k, v] of m) if (k === "r") console.log("iter", same(v, r), v.n);
  m.forEach((v, k) => { if (k === "arr") console.log("each", same(v, arr), v.length); });
  console.log(same([...m.values()][0], r), [...m.keys()].length);
}
values();

function keys() {
  const m = mk(), s = mks();
  const k1 = { id: 1 }, k2 = { id: 1 }, ka = [1], kf = () => 0, kb = new Box(1);
  m.set(k1, "one"); m.set(ka, "arr"); m.set(kf, "fn"); m.set(kb, "box");
  s.add(k1); s.add(ka); s.add(kf); s.add(kb);
  console.log(m.get(k1), m.get(k2), m.get([1]), m.get(ka), m.get(kf), m.get(() => 0), m.get(kb), m.get(new Box(1)));
  console.log(s.has(k1), s.has(k2), s.has(ka), s.has(kf), s.has(kb), s.size);
  console.log(same([...m.keys()][0], k1), same([...s][1], ka), same([...s][3], kb));
  k1.id = 9;
  console.log(m.get(k1), [...m.keys()][0].id);
  console.log(m.delete(k1), m.has(k1), m.size);
}
keys();

// file scope: the same contract
const top = { n: 1 };
const topArr = [1];
const reg = mk();
reg.set("t", top); reg.set("a", topArr);
top.n = 5; topArr.push(2);
console.log(reg.get("t").n, reg.get("t") === top, reg.get("a").length, reg.get("a") === topArr);
const nested = mk();
const level = mk();
nested.set("level", level); level.set("x", { y: 1 });
console.log(nested.get("level") === level, nested.get("level").get("x").y);
