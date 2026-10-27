// TypedArray.prototype.set with a plain array source: each element is
// coerced by the receiver's own element kind (ToUint8, ToUint8Clamp,
// ToInt16, float32/float16 rounding), and an overflowing source throws.
const u = new Uint8Array(4);
u.set([1, 256, -1, 300.7]);
console.log(u[0], u[1], u[2], u[3]);
u.set([9, 8], 2);
console.log(u[0], u[1], u[2], u[3]);

const c = new Uint8ClampedArray(3);
c.set([300, -5, 2.5]);
console.log(c[0], c[1], c[2]);

const s = new Int16Array(2);
s.set([70000, -40000]);
console.log(s[0], s[1]);

const h = new Float16Array(2);
h.set([0.1, 65520]);
console.log(h[0], h[1]);

const numbers: number[] = [5, 6, 7];
const w = new Uint16Array(4);
w.set(numbers, 1);
console.log(w[0], w[1], w[2], w[3]);

try {
  new Uint8Array(2).set([1, 2, 3]);
  console.log("no throw");
} catch (e) {
  console.log((e as Error).name, (e as Error).message);
}
