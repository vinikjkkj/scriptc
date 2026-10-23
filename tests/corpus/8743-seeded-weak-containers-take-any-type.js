// Seeded weak containers keyed by class instances. The seed fixes the value
// type (`new WeakMap([[k, 1]])` is WeakMap<K, number>) and untyped code then
// stores another one; the dyn-flavoured weak box takes it.
'use strict';

class Key { constructor(n) { this.n = n; } }
const k1 = new Key(1);
const k2 = new Key(2);
const k3 = new Key(3);

function put(w, k, v) { w.set(k, v); }
function add(s, v) { s.add(v); }

const w = new WeakMap([[k1, 1]]);
put(w, k1, "replaced");
put(w, k2, { two: 2 });
put(w, k3, null);
console.log(w.get(k1), w.get(k2).two, w.get(k3), w.has(k3), w.has(new Key(9)));
console.log(w.delete(k2), w.has(k2));

const ws = new WeakSet([k1]);
add(ws, k2);
console.log(ws.has(k1), ws.has(k2), ws.has(k3), ws.has(new Key(1)));
