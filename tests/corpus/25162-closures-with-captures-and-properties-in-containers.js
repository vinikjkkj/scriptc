// Closures with captures, with a property table, with a minted prototype, with all of them and with none, living in arrays, maps and
// object fields at once: the single ext pointer must not shift caps[] (read after the ext slot) for any combination.
"use strict";
function build(i) {
  const a = i, b = "s" + i, c = [i, i + 1];
  let m = i * 3;
  function f(x) { m += x; return a + b.length + c[1] + m; }
  if (i & 1) f.p1 = i;
  if (i & 2) f.prototype.q = i;
  if (i & 4) Object.defineProperty(f, "h", { value: i, writable: true, enumerable: true });
  return f;
}
const arr = [];
const map = new Map();
const obj = {};
for (let i = 0; i < 64; i++) {
  const f = build(i);
  arr.push(f);
  map.set(i, f);
  obj["k" + i] = f;
}
let acc = 0;
for (let i = 0; i < 64; i++) {
  acc += arr[i](i) + map.get(i)(1) + obj["k" + i](2);
  if (i & 1) acc += arr[i].p1;
  if (i & 4) acc += arr[i].h;
  if (i & 2) acc += new arr[i](0).q;
}
console.log("acc", acc);
console.log(Object.keys(arr[7]).join(","), Object.keys(arr[6]).join(","), Object.keys(arr[1]).join(","));
arr.length = 0;
map.clear();
for (const k of Object.keys(obj)) delete obj[k];
console.log("released");
