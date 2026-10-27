// BigInt64Array / BigUint64Array fill, indexOf, includes and sort: values are
// bigints, search is by value, sort() is numeric ascending in place.
const s = new BigInt64Array(6);
s.fill(-4n);
console.log(s[0], s[5]);
s.fill(9n, 2, 4);
console.log(s[1], s[2], s[3], s[4]);
s.fill(1n, -1);
console.log(s[5], s[4]);

const t = new BigInt64Array(5);
t[0] = 30n;
t[1] = -2n;
t[2] = 17n;
t[3] = 17n;
t[4] = 9223372036854775807n;
console.log(t.indexOf(17n), t.indexOf(17n, 3), t.indexOf(99n));
console.log(t.includes(-2n), t.includes(4n), t.includes(9223372036854775807n));
console.log(t.indexOf(17n, -2), t.includes(30n, 1));

t.sort();
console.log(t[0], t[1], t[2], t[3], t[4]);

const u = new BigUint64Array(4);
u[0] = 18446744073709551615n;
u[1] = 3n;
u[2] = 0n;
u[3] = 3n;
u.sort();
console.log(u[0], u[1], u[2], u[3]);
console.log(u.indexOf(3n), u.includes(18446744073709551615n));
