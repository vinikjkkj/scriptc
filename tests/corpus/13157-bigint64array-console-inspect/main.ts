// console.log and util.inspect of BigInt64Array / BigUint64Array: Node's
// `BigInt64Array(n) [ 1n, ... ]` form with bigint entries.
import { inspect } from "node:util";

console.log(new BigInt64Array(0));
const s = new BigInt64Array(4);
s[0] = 5n;
s[1] = -7n;
s[2] = 9223372036854775807n;
s[3] = -9223372036854775808n;
console.log(s);
const u = new BigUint64Array(3);
u[0] = 18446744073709551615n;
u[1] = 42n;
console.log(u);
const one = new BigUint64Array(1);
one[0] = 1n;
console.log(inspect(one));
const big = new BigInt64Array(120);
for (let i = 0; i < 120; i++) big[i] = BigInt(i) * 11n;
console.log(big);
