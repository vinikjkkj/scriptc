// BigInt64Array / BigUint64Array iteration and views: for-of and array
// destructuring yield bigints; set, subarray and slice keep the bigint kind.
const s = new BigInt64Array(5);
for (let i = 0; i < 5; i++) s[i] = BigInt(i) * -3n;

let total = 0n;
for (const v of s) total += v;
console.log(total);

const [a, b] = s;
console.log(a, b);

const sub = s.subarray(1, 4);
console.log(sub.length, sub.byteLength, sub[0], sub[2]);
sub[1] = 100n;
console.log(s[2]);

const copy = s.slice(2);
console.log(copy.length, copy[0], copy[2]);
copy[0] = 7n;
console.log(s[2], copy[0]);

const dst = new BigInt64Array(3);
const src2 = new BigInt64Array(2);
src2[0] = 10n;
src2[1] = 20n;
dst.set(src2, 1);
console.log(dst[0], dst[1], dst[2]);

const u = new BigUint64Array(2);
const src3 = new BigUint64Array(1);
src3[0] = 18446744073709551615n;
u.set(src3);
console.log(u[0], u.length);
