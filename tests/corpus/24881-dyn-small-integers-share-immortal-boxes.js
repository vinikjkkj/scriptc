// Small non-negative integers that cross into the dynamic tree (JSON.parse results, untyped members, arithmetic results through
// untyped values) are shared immortal boxes: every observable behaves as a fresh value would. The edges: -0, NaN, fractions,
// 255/256, negatives, and writes that must never reach another number.
const p = JSON.parse('{"a":0,"b":-0,"c":1,"d":255,"e":256,"f":1.5,"g":-1,"h":[0,1,2,255,256,-0,0.0,1e0,25e-1]}');
console.log(p.a, p.b, Object.is(p.a, 0), Object.is(p.b, -0), 1 / p.a, 1 / p.b, p.c, p.d, p.e, p.f, p.g, p.h);
console.log(JSON.stringify(p), Object.keys(p.h).length, p.h.map((x) => 1 / x).join());
const o = {};
for (let i = 0; i < 300; i++) o["k" + i] = i;
let sum = 0;
for (const k of Object.keys(o)) sum += o[k];
o.k5 = o.k5 + 1;
o.k6++;
o.k7 += 10;
console.log(sum, o.k5, o.k6, o.k7, o.k255, o.k256, o.k4, JSON.stringify(o).length);
const arr = [];
for (let i = 0; i < 20; i++) arr.push(i % 7);
arr[3] = arr[3] + 100;
arr.sort((x, y) => y - x);
console.log(arr, arr.indexOf(0), arr.lastIndexOf(0), arr.includes(255), new Set(arr).size);
function id(x) { return x; }
const zero = id(0), negz = id(-0), one = id(1), big = id(256), nan = id(NaN), frac = id(0.5);
console.log(Object.is(zero, 0), Object.is(negz, -0), Object.is(negz, 0), one === 1, big === 256, nan !== nan, frac, 1 / zero, 1 / negz);
console.log(zero + one, one - one, 255 + id(1), id(254) + one, id(3) * id(0), 1 / (id(3) * id(-0)), Math.max(id(0), id(-0)), -id(0));
// planted mutation: a property written on a shared number, a counter incremented through an alias, a number as a Map key
const q = JSON.parse("[1,1,2,0,0]");
try { q[0].tag = "x"; } catch (e) { console.log("threw", e.constructor.name); }
console.log(q[0].tag, q[1].tag, q[2].tag, id(1).tag, JSON.stringify(q));
let c = q[0];
c++;
c += q[1];
console.log(c, q, q[0] === q[1]);
const m = new Map();
m.set(q[0], "one"); m.set(q[3], "zero"); m.set(id(-0), "negzero");
console.log(m.get(1), m.get(0), m.get(-0), m.size, [...m.keys()].map((k) => Object.is(k, -0)).join());
const copy = structuredClone(p);
copy.c = 99; copy.a = 7;
console.log(p.c, p.a, copy.c, copy.a, p.h[1]);
