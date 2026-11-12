// Dyn numbers that are small integers share one immortal box per value. Everything observable must stay what Node answers: the sign of zero
// (Object.is and 1/x tell -0 from 0), NaN, Infinity, fractions and the integers on both sides of the shared range, whatever way the number
// was made (arithmetic on dyn operands, JSON.parse, the increment operators, a compound assignment, a property and an array element) and
// whatever is done with it afterwards. A shared box must never be edited in place: incrementing one holder of 7 must leave every other 7 alone.
function id(x) { return x; }
function add(a, b) { return a + b; }
function sub(a, b) { return a - b; }
function mul(a, b) { return a * b; }
function neg(a) { return -a; }
const probes = [-1025, -129, -128, -127, -65, -2, -1, 0, 1, 2, 7, 63, 64, 255, 256, 511, 512, 1022, 1023, 1024, 1025, 4096, 65536, 0.5, -0.5, 1.5, 0.1 + 0.2, 1e21, 2 ** 53, 2 ** 31, -(2 ** 31), 2 ** 32, Infinity, -Infinity, NaN];
for (const p of probes) {
  const a = add(p, 0), b = mul(p, 1), c = add(sub(p, 1), 1), d = id(p);
  console.log(String(p), Object.is(a, p), Object.is(b, p), Object.is(c, p), Object.is(d, p), 1 / a, String(a), JSON.stringify([a]));
}
// the sign of zero, made by every operator that can make one
const z = [mul(0, -1), mul(-1, 0), neg(0), add(-0, -0), sub(-0, 0), mul(-3, 0), add(-0, 0), sub(0, 0), mul(0, 1), neg(neg(0)), id(-0), id(0)];
console.log(z.map((v) => Object.is(v, -0) ? "-0" : Object.is(v, 0) ? "+0" : String(v)).join(" "));
console.log(z.map((v) => 1 / v).join(" "));
console.log(JSON.stringify(z), String(z), `${neg(0)}`, (neg(0)).toString(), [neg(0)].join());
const zs = new Set([neg(0), add(0, 0), mul(0, 1)]);
console.log(zs.size, [...zs].map((v) => 1 / v).join(" "));
const zm = new Map([[neg(0), "a"]]);
console.log(zm.get(0), zm.get(neg(0)), [...zm.keys()].map((v) => 1 / v).join(" "));
const parsed = JSON.parse("[7, 7.0, 7e0, 70e-1, 0.7e1, -0, 0, -0.0, 1024, 1023, -128, -129, 0.5, 1e400, -1e400, 12345678901234567890]");
console.log(parsed.map((v) => Object.is(v, -0) ? "-0" : String(v)).join(" "), parsed.map((v) => 1 / v).join(" "));
console.log(Object.is(parsed[0], parsed[1]), Object.is(parsed[0], add(3, 4)), Object.is(parsed[5], -0), Object.is(parsed[6], 0), Object.is(parsed[7], -0));
// no holder of a shared value can change another's
let h1 = add(3, 4), h2 = add(2, 5), h3 = JSON.parse("7");
h1++;
console.log(h1, h2, h3, add(3, 4));
h2 += 100;
h3--;
console.log(h1, h2, h3, add(3, 4), mul(7, 1));
const o = { n: add(3, 4), m: add(3, 4) };
o.n++;
o.m += 5;
o.k = o.n;
o.k *= 2;
console.log(JSON.stringify(o), add(3, 4));
const arr = [add(3, 4), add(3, 4), JSON.parse("7")];
arr[0]++;
arr[1] = arr[1] + 1;
arr[2] -= 7;
arr.push(arr[2]);
arr[3]++;
console.log(arr.join(), add(3, 4), Object.is(arr[2], 0), Object.is(arr[2], -0));
let w = add(0, 0);
w = -w;
console.log(Object.is(w, -0), Object.is(add(0, 0), 0), 1 / add(0, 0), 1 / w);
let cnt = id(0);
for (let i = 0; i < 2000; i++) cnt += i % 3;
console.log(cnt, add(0, 0), add(1, 0), add(2, 0));
// counters and sums that cross the edges of the shared range, up and down
let up = id(1020), dn = id(-125);
const seen = [];
for (let i = 0; i < 8; i++) { seen.push(up, dn); up++; dn--; }
console.log(seen.join(" "));
// sort, comparison, Math, typeof, == and === over shared and unshared numbers
const mix = [add(100, 1), add(1000, 30), add(0, 5), add(2, 0), mul(2, 600), add(-1, -2)];
mix.sort((a, b) => a - b);
console.log(mix.join(), mix.indexOf(add(1, 1)), mix.includes(add(500, 500) + 30), mix.reduce((x, y) => (x > y ? x : y)), mix.reduce((x, y) => (x < y ? x : y)), typeof mix[0], mix[0] == -3, mix[0] === add(-2, -1));
// property order and accessors: removing a data property shifts the position of the non-enumerable ones that follow it
const ob = JSON.parse('{"a":1,"b":2,"c":3,"d":4}');
Object.defineProperty(ob, "e", { get() { return 5; }, enumerable: false, configurable: true });
ob.f = 6;
Object.defineProperty(ob, "g", { get() { return 7; }, enumerable: false, configurable: true });
ob.h = 8;
delete ob.a;
console.log(Object.keys(ob).join(), ["e", "g"].map((k) => k in ob && Object.hasOwn(ob, k) && typeof Object.getOwnPropertyDescriptor(ob, k).get).join(), ob.e, ob.g);
delete ob.c;
delete ob.f;
console.log(Object.keys(ob).join(), ["e", "g"].map((k) => k in ob && Object.hasOwn(ob, k) && typeof Object.getOwnPropertyDescriptor(ob, k).get).join(), ob.e, ob.g, JSON.stringify(ob));
ob.z = 26;
delete ob.b;
console.log(["e", "g"].map((k) => k in ob && Object.hasOwn(ob, k) && typeof Object.getOwnPropertyDescriptor(ob, k).get).join(), JSON.stringify(Object.getOwnPropertyDescriptor(ob, "e")?.enumerable), ob.e + ob.g + ob.z);
