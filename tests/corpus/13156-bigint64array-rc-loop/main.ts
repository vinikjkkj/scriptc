// Refcount pin for bigint element reads and writes: every read produces a
// fresh bigint that must be released, every write only borrows its value.
// The loop is small on purpose (the sanitized build runs it under ASan).
const v = new BigInt64Array(16);
const w = new BigUint64Array(16);
let acc = 0n;
for (let i = 0; i < 3000; i++) {
  const k = i % 16;
  v[k] = BigInt(i) * 1000003n - 5000n;
  w[k] = BigInt(i) * 7n;
  acc += v[k] + w[(k + 3) % 16];
  if (v[k] < 0n) acc -= 1n;
}
console.log(acc);
console.log(v[0], v[15], w[0], w[15]);
