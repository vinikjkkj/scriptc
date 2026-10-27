// BigInt64Array / BigUint64Array element reads and writes: a read is a bigint,
// a write takes a bigint and keeps its low 64 bits (ToBigInt64 / ToBigUint64).
const s = new BigInt64Array(4);
const u = new BigUint64Array(4);
console.log(s.length, s.byteLength, s.BYTES_PER_ELEMENT, u.BYTES_PER_ELEMENT);
console.log(s[0], u[1]);

s[0] = 5n;
s[1] = -7n;
s[2] = 9223372036854775807n;
s[3] = -9223372036854775808n;
console.log(s[0], s[1], s[2], s[3]);

u[0] = 18446744073709551615n;
u[1] = -1n;
u[2] = 18446744073709551621n;
u[3] = 0n;
console.log(u[0], u[1], u[2], u[3]);

s[0] = 9223372036854775808n;
console.log(s[0]);
s[1] = 18446744073709551615n;
console.log(s[1]);

const sum: bigint = s[0] + s[1] + 1n;
console.log(sum, s[2] * 2n, u[0] - u[3]);
console.log(s[1] < s[0], u[2] === 5n, typeof s[0]);
