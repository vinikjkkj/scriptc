// JAVASCRIPT `new WeakMap()` / `new WeakSet()` with no annotation: the
// dyn-flavored weak containers. get/set/has/delete/add are real, a primitive
// key throws V8's own TypeError at set()/add() and simply misses at
// get/has/delete, and there is no `size` and no iteration (a spread throws).
// The entries are held strongly: the weakness is not observable here.
'use strict';

function mkw() { return new WeakMap(); }
function mkm() { return new WeakMap(); }
function mks() { return new WeakSet(); }
const wm = mkm(), ws = mks();
const k1 = {}, k2 = [], k3 = () => 1;
wm.set(k1, "a"); wm.set(k2, "b").set(k3, "c");
console.log(wm.get(k1), wm.get(k2), wm.get(k3), wm.get({}), wm.has(k1), wm.has({}), wm.has(1), wm.get("x"));
console.log(wm.delete(k1), wm.delete(k1), wm.has(k1), wm.delete("x"));
ws.add(k1).add(k2); ws.add(k1);
console.log(ws.has(k1), ws.has({}), ws.has(5), ws.delete(k1), ws.has(k1), ws.delete(k1));
try { wm.set("str", 1); } catch (e) { console.log(e.name, e.message); }
try { wm.set(1, 1); } catch (e) { console.log(e.name, e.message); }
try { ws.add(null); } catch (e) { console.log(e.name, e.message); }
try { ws.add(undefined); } catch (e) { console.log(e.name, e.message); }
console.log(wm.size, ws.size, typeof wm, wm instanceof Map, Object.prototype.toString.call(wm), Object.prototype.toString.call(ws), JSON.stringify(wm), String(ws));
console.log(wm);
console.log(ws);
const seeded = mkw(); seeded.set(k1, k1);
function mkseed(e) { return new WeakMap(e); }
console.log(mkseed([]).get(k1) !== undefined, seeded.get(k1) !== undefined);
try { mkseed([["s", "t"]]); } catch (e) { console.log(e.name, e.message); }
try { [...wm]; } catch (e) { console.log(e.name); }
class Cache { constructor() { this.c = new WeakMap(); this.s = new WeakSet(); } put(o, v) { this.c.set(o, v); this.s.add(o); } has(o) { return this.s.has(o); } get(o) { return this.c.get(o); } }
const c = new Cache(); c.put(k1, 5); console.log(c.get(k1), c.has(k1), c.has(k2));
