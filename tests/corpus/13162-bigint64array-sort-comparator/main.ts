// BigInt64Array / BigUint64Array sort and toSorted with a comparator: the
// callback takes bigints, and the order is the callback's (stable).
const s = new BigInt64Array(5);
s[0] = 5n;
s[1] = -2n;
s[2] = 9n;
s[3] = 0n;
s[4] = -7n;
s.sort((a, b) => (a < b ? 1 : a > b ? -1 : 0));
console.log(s[0], s[1], s[2], s[3], s[4]);

const t = new BigUint64Array(4);
t[0] = 18446744073709551615n;
t[1] = 3n;
t[2] = 40n;
t[3] = 3n;
const d = t.toSorted((a, b) => (a > b ? -1 : a < b ? 1 : 0));
console.log(d[0], d[1], d[2], d[3], t[0], t[1]);

const u = new BigInt64Array(3);
u[0] = 2n;
u[1] = -9n;
u[2] = 4n;
u.sort();
console.log(u[0], u[1], u[2]);
