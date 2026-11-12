// A function value that crosses into a dynamic value is boxed. The box carries the closure, the call glue, the signature, the function's
// name and its source text; the properties set on the function live on the closure. Everything observable is checked against Node: inspect,
// String(), name, length, typeof, identity after crossing twice, properties written through the dynamic view, and boxes recycled across kinds.
function plain(a, b) { return a + b; }
const arrow = (x) => x + "!";
const anon = () => 42;
class Box {
  constructor() { this.n = 3; }
  inc(by) { return this.n + by; }
}
const bx = new Box();
const bound = bx.inc.bind(bx);
async function later(v) { return v * 2; }

const hold = [];
function asDyn(f) { hold.push(f); return f; }

const dp = asDyn(plain);
const da = asDyn(arrow);
const dn = asDyn(anon);
const db = asDyn(bound);
const dl = asDyn(later);

console.log(typeof dp, typeof da, typeof dn, typeof db, typeof dl);
console.log(dp.name, da.name, JSON.stringify(dn.name), db.name, dl.name);
console.log(dp.length, da.length, dn.length, db.length, dl.length);
console.log(String(dp));
console.log(String(da));
console.log(String(dn));
console.log(String(db));
console.log(String(dl));
console.log(dp(2, 3), da("hey"), dn(), db(4));

const dp2 = asDyn(plain);
console.log(dp === dp2, da === asDyn(arrow), dp === da);

dp.tag = "first";
dp2.count = 7;
console.log(dp.tag, dp2.tag, dp.count, Object.keys(dp).join(","));
console.log(plain.tag, plain.count);

console.log(dp);
console.log([dp, da]);
console.log({ f: dp, g: dn });
console.log(Object.prototype.toString.call(dp));
console.log(JSON.stringify({ f: dp, n: 1, a: [dn, 2] }));

let sum = 0;
for (let round = 0; round < 50; round++) {
  const live = [];
  for (let i = 0; i < 40; i++) {
    const k = (i + round) % 7;
    live.push(k === 0 ? i + 0.5 : k === 1 ? "s" + i : k === 2 ? i % 2 === 0 : k === 3 ? [i, i + 1] : k === 4 ? { a: i } : k === 5 ? asDyn(plain) : asDyn(bx));
  }
  for (const v of live) {
    sum += typeof v === "function" ? v(1, 2) : typeof v === "number" ? v : typeof v === "string" ? v.length : typeof v === "boolean" ? (v ? 1 : 0) : Array.isArray(v) ? v.length : typeof v === "object" ? Object.keys(v).length : 0;
  }
}
console.log("churn", sum);
