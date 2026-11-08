// Booleans and null that cross into the dynamic tree (JSON.parse results, untyped object members, untyped array elements,
// values returned through an untyped function) are shared immortal boxes: every observable behaves as a fresh value would.
const parsed = JSON.parse('{"a":true,"b":false,"c":null,"d":[true,false,null,true]}');
console.log(parsed.a, parsed.b, parsed.c, parsed.d, parsed.a === true, parsed.b === false, parsed.c === null);
const o = {};
for (let i = 0; i < 5; i++) o["k" + i] = i % 2 === 0;
o.k0 = null;
o.k1 = true;
console.log(JSON.stringify(o), Object.keys(o).length);
const arr = [];
for (let i = 0; i < 6; i++) arr.push(i % 3 === 0);
arr[1] = null;
console.log(arr, arr.filter(Boolean).length);
function id(x) {
  return x;
}
const t = id(true);
const f = id(false);
const n = id(null);
console.log(typeof t, typeof n, t === true, n === null, Object.is(t, true), [t, f, n].map(String).join());
const m = new Map();
m.set(true, "t");
m.set(null, "n");
console.log(m.get(true), m.get(null), m.size);
const w = JSON.parse("[true,true,false]");
w[0] = false;
w[2] = true;
console.log(w, JSON.stringify(w), parsed.d[0], parsed.d);
const copy = structuredClone(parsed);
copy.a = false;
console.log(parsed.a, copy.a, JSON.stringify(copy));
