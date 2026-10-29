// globalThis.crypto.getRandomValues over a statically typed array. The fill
// answers the SAME array (identity), every integer-typed array kind is
// accepted, and the refusals name Node's DOMException (name and message):
// Float16Array and Float32Array are float arrays, a DataView is not a typed
// array at all, and a quota past 65,536 bytes is QuotaExceededError. The
// values are random: only lengths, classes, identity, and errors print.
const arr = new Uint8Array(65536);
const same = crypto.getRandomValues(arr);
arr[0] = 42;
console.log('same', same[0], same.length);
const small = new Uint8Array(4);
const back = crypto.getRandomValues(small);
small[3] = 77;
console.log('identity', back[3], back.length, back instanceof Uint8Array);
try {
  crypto.getRandomValues(new Uint8Array(65537));
} catch (e) {
  console.log('quota', e.name, e.message, e instanceof DOMException);
}
try {
  crypto.getRandomValues(new Float32Array(4));
} catch (e) {
  console.log('float32', e.name, e.message, e instanceof DOMException);
}
try {
  crypto.getRandomValues(new Float64Array(4));
} catch (e) {
  console.log('float64', e.name, e.message);
}
try {
  crypto.getRandomValues(new Float16Array(2));
} catch (e) {
  console.log('float16', e.name, e.message, e instanceof DOMException);
}
try {
  crypto.getRandomValues(new DataView(new ArrayBuffer(4)));
} catch (e) {
  console.log('dataview', e.name, e.message);
}
const i8 = crypto.getRandomValues(new Int8Array(3));
const big = crypto.getRandomValues(new BigInt64Array(2));
const clamped = crypto.getRandomValues(new Uint8ClampedArray(5));
const i16 = crypto.getRandomValues(new Int16Array(3));
const u16 = crypto.getRandomValues(new Uint16Array(3));
console.log('kinds', i8.length, big.length, clamped.length, i16.length, u16.length);
console.log('zero', crypto.getRandomValues(new Uint8Array(0)).length);
console.log('typeof', typeof crypto.getRandomValues, typeof crypto.randomUUID);
