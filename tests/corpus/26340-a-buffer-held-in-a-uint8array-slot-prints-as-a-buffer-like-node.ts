// The static type only names the slot: a Buffer handed through a Uint8Array-typed parameter is still a Buffer to inspect.
const b = Buffer.from([1, 2, 3]);
function show(u: Uint8Array): void {
  console.log(u);
  console.log(Buffer.isBuffer(u));
}
show(b);
const u: Uint8Array = b;
console.log(u);
console.log(u.slice(1), u.subarray(1), b.slice(1), b.subarray(1));
// Controls: values that are plain Uint8Arrays in Node keep the typed-array form.
const plain = new Uint8Array(b);
console.log(plain);
show(plain);
console.log(Uint8Array.from(b));
console.log(new TextEncoder().encode("hi"));
console.log(new Uint8Array([1, 2]).slice(1));
const fromBuf: Uint8Array = new Uint8Array(b.buffer, b.byteOffset, b.length);
console.log(fromBuf);
