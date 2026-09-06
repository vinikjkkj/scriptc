// TypedArray.prototype.copyWithin — an OVERLAPPING in-place move.
//
// memmove and not memcpy is the whole point: source and destination are the
// same buffer and are expected to overlap. zapo-js 1.8.2 slides a trailing
// HMAC window down over itself with it (media/crypto/WaMediaCrypto.ts:508),
// which is exactly the case memcpy leaves undefined.
//
// The count is clamped twice per spec — by available source (final - from)
// and by remaining destination room (len - to) — and every index is
// slice-style relative. None of it throws.

function show(a: Uint8Array): string {
  const out: string[] = [];
  for (let i = 0; i < a.length; i++) out.push(String(a[i]));
  return out.join(",");
}
function fresh(): Uint8Array {
  return new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7]);
}

let a = fresh();
console.log("identity:", show(a.copyWithin(0, 0)));

a = fresh();
console.log("forward overlap:", show(a.copyWithin(0, 3)));

a = fresh();
console.log("backward overlap:", show(a.copyWithin(3, 0)));

a = fresh();
console.log("bounded:", show(a.copyWithin(0, 3, 5)));

a = fresh();
console.log("negative target:", show(a.copyWithin(-2, 0)));

a = fresh();
console.log("negative start:", show(a.copyWithin(0, -3)));

a = fresh();
console.log("negative end:", show(a.copyWithin(0, 0, -6)));

a = fresh();
console.log("start past end:", show(a.copyWithin(0, 99)));

a = fresh();
console.log("target past end:", show(a.copyWithin(99, 0)));

a = fresh();
console.log("empty range:", show(a.copyWithin(0, 5, 2)));

a = fresh();
console.log("clamped by room:", show(a.copyWithin(6, 0)));

a = fresh();
console.log("fractional:", show(a.copyWithin(1.9, 0.2, 3.7)));

// It returns the receiver, so it chains and the result aliases.
a = fresh();
const same = a.copyWithin(0, 2);
same[0] = 99;
console.log("returns receiver:", a[0] === 99, show(a));

// A wider element type: indices count ELEMENTS, not bytes.
const w = new Uint32Array([10, 20, 30, 40]);
w.copyWithin(0, 2);
console.log("u32 elements:", w[0], w[1], w[2], w[3]);

// A view over a larger buffer moves only within its own window.
const base = new Uint8Array([9, 9, 1, 2, 3, 4, 9, 9]);
const view = base.subarray(2, 6);
view.copyWithin(0, 2);
console.log("through a view:", show(view), "|", show(base));
