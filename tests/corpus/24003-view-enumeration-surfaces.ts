// Keys, entries, JSON, spread, `in`, hasOwn and inspect of a view show the REAL object: its undeclared own
// keys and its class prefix.
class Point { x = 1; y = 2; secret = "s"; }
interface XY { x: number; y: number }
const plain = JSON.parse('{"x":1,"y":2,"z":3}') as unknown;
const p = plain as XY;
console.log(Object.keys(p), Object.values(p), Object.entries(p));
console.log(JSON.stringify(p), p);
const copy = { ...p };
copy.x = 100;
console.log(copy, p.x, JSON.stringify(copy));
console.log("z" in p, "x" in p, "nope" in p, Object.hasOwn(p, "z"), Object.hasOwn(p, "nope"));
for (const k in p) console.log("key", k);
const inst = new Point() as unknown;
const q = inst as XY;
console.log(Object.keys(q), JSON.stringify(q), q);
console.log("secret" in q, Object.hasOwn(q, "secret"));
const qc = { ...q };
qc.y = 20;
console.log(qc, q.y);
