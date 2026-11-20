// Typed-array callback methods over every numeric width: forEach, map, filter, every, some, find*, reduce*, thisArg, live reads, a Buffer receiver.
const f = new Float64Array([3.5, -1, 2, 8, 2]);
const i = new Int32Array([5, 6, 7, 8]);
const u = new Uint8Array([200, 100, 50]);
const log: unknown[] = [];
f.forEach((v, idx, arr) => log.push([v, idx, arr.length]));
f.forEach((v) => log.push(v));
console.log(log);
console.log(i.map((v) => v * 2), i.map((v, idx) => v + idx), u.map((v) => v * 2), f.map((v) => v / 2), new Uint8ClampedArray([1, 2]).map((v) => v * 200));
console.log(f.filter((v) => v > 2), i.filter((v, idx) => idx % 2 === 0), u.filter((v) => v > 1000), i.filter(() => true));
console.log(f.every((v) => v > -2), f.every((v) => v > 0), f.some((v) => v > 8), f.some((v) => v > 7), new Int8Array(0).every(() => false), new Int8Array(0).some(() => true));
console.log(f.find((v) => v > 2), f.find((v) => v > 99), f.findIndex((v) => v === 2), f.findIndex((v) => v === 99), f.findLast((v) => v === 2), f.findLastIndex((v) => v === 2), f.findLast((v) => v > 99));
console.log(i.reduce((a, b) => a + b), i.reduce((a, b) => a + b, 100), i.reduceRight((a, b) => a * 10 + b), i.reduceRight((a, b) => a - b, 0), f.reduce((a, v, idx) => a + v * idx, 0), i.reduce((a, b, idx, arr) => a + arr.length, 0));
try { new Int8Array(0).reduce((a, b) => a + b); } catch (e: any) { console.log(e.name, e.message); }
try { new Int8Array(0).reduceRight((a, b) => a + b); } catch (e: any) { console.log(e.name, e.message); }
console.log(new Int8Array(0).reduce((a, b) => a + b, 7));
const w = new Int32Array([1, 2, 3, 4]);
const seen: number[] = [];
w.forEach((v, idx) => { seen.push(v); if (idx === 0) w[2] = 99; });
console.log(seen, w.map((v) => v, 1));
const ctx = { k: 10 };
console.log(w.map(function (this: { k: number }, v) { return v + this.k; }, ctx), w.filter(function (this: { k: number }, v) { return v > this.k; }, ctx));
console.log(i.find((v, idx, arr) => arr[idx] === 7), new Float32Array([0.5, 1.5]).map((v) => v * 3));
const fn = (v: number) => v + 1;
console.log(i.map(fn), i.some(Boolean), i.findIndex(Number.isInteger));
{
  const b = Buffer.from([1, 2, 3, 4]);
  console.log(b.map((v) => v * 2).join(), b.filter((v) => v > 2).join(), Buffer.isBuffer(b.map((v) => v)), b.every((v) => v > 0), b.find((v) => v > 1), b.reduce((a, c) => a + c, 0));
  const u8: Uint8Array = b;
  console.log(u8.map((v) => v + 1).join(), u8.filter((v) => v % 2 === 0).join(), u8.at(-1), u8.indexOf(3), u8.includes(4), u8.reverse().join());
  let n = 0; b.forEach((v) => { n += v; }); console.log(n);
}
