// Dynamic values of every kind: a node is allocated at the size its kind needs, so a scalar, a string, a bool, bytes, a bigint, a promise,
// a class instance, an array, an object, a Map and a Proxy each live in their own size class and a recycled node comes back in the same one.
// This row builds, mutates, grows, drops and rebuilds all of them in interleaved order and prints every observable, so a read past a node's
// arm or a node reused across classes would change a line. It also round-trips JSON and compares equality and ordering.
class Point { constructor(x, y) { this.x = x; this.y = y; } sum() { return this.x + this.y; } }
/** @param {number} i */
const kinds = (i) => {
  switch (i % 12) {
    case 0: return i * 1.25;
    case 1: return "str" + i;
    case 2: return i % 2 === 0;
    case 3: return null;
    case 4: return undefined;
    case 5: return Buffer.from("buf" + i);
    case 6: return BigInt(i) * 1000000000000n;
    case 7: return [i, "a" + i, [i + 1], { k: i }];
    case 8: return { id: i, name: "n" + i, nested: { v: [i, i + 1] } };
    case 9: return new Map([["k" + i, i], ["z", i + 1]]);
    case 10: return new Point(i, i + 1);
    default: return new Proxy({ base: i }, { get: (t, p) => (p in t ? t[p] : "dflt" + String(p)) });
  }
};
const describe = (v) => {
  if (v === null) return "null";
  if (v === undefined) return "undef";
  switch (typeof v) {
    case "number": return "n" + v;
    case "string": return "s" + v;
    case "boolean": return "b" + v;
    case "bigint": return "B" + v;
    default:
  }
  if (Buffer.isBuffer(v)) return "buf" + v.toString("hex");
  if (Array.isArray(v)) return "arr" + JSON.stringify(v);
  if (v instanceof Map) return "map" + JSON.stringify([...v]);
  if (v instanceof Point) return "pt" + v.sum();
  return "obj" + JSON.stringify(v) + (v.missing === undefined ? "" : v.missing);
};
let out = [];
for (let round = 0; round < 6; round++) {
  const live = [];
  for (let i = 0; i < 48; i++) live.push(kinds(i + round * 5));
  for (let i = 0; i < live.length; i += 7) out.push(describe(live[i]));
  // grow and shrink the containers
  const arr = live.filter(Array.isArray);
  const obj = live.filter((v) => v !== null && typeof v === "object" && !Array.isArray(v) && !Buffer.isBuffer(v) && !(v instanceof Map) && !(v instanceof Point) && "id" in v);
  for (const a of arr) { for (let k = 0; k < 40; k++) a.push(k); a.length = 3; }
  for (const o of obj) { for (let k = 0; k < 30; k++) o["extra" + k] = k; for (let k = 0; k < 30; k += 2) delete o["extra" + k]; }
  out.push("arr" + arr.map((a) => a.length).join(",") + " obj" + obj.map((o) => Object.keys(o).length).join(","));
  // drop everything but a few, rebuild different kinds into the freed nodes
  live.length = 5;
  const again = [];
  for (let i = 0; i < 60; i++) again.push(kinds(i * 3 + round));
  out.push(again.map(describe).filter((_, i) => i % 11 === 0).join("|"));
}
const doc = [];
for (let i = 0; i < 100; i++) doc.push(kinds(i % 12 === 5 || i % 12 === 6 || i % 12 === 9 || i % 12 === 10 || i % 12 === 11 ? 0 : i));
const text = JSON.stringify(doc);
const back = JSON.parse(text);
out.push(String(text.length), String(back.length), String(back[7].length), JSON.stringify(back[8]));
out.push(String(kinds(0) === kinds(0)), String(kinds(1) === kinds(1)), String(kinds(7) === kinds(7)));
console.log(out.join("\n"));
