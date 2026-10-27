// BigInt64Array / BigUint64Array: toSorted copies (the receiver is untouched),
// lastIndexOf searches from the end by value, and rest destructuring yields a
// bigint array.
const s = new BigInt64Array(4);
s[0] = 5n;
s[1] = -2n;
s[2] = 9n;
s[3] = -2n;
const t = s.toSorted();
console.log(t[0], t[1], t[2], t[3], s[0], s[1], s[2], s[3]);

const u = new BigUint64Array(3);
u[0] = 7n;
u[1] = 2n;
u[2] = 7n;
console.log(u.lastIndexOf(7n), u.lastIndexOf(7n, 1), u.lastIndexOf(2n, -1), u.lastIndexOf(9n));
console.log(u.lastIndexOf(7n, -3), u.lastIndexOf(7n, 99));

const [first, ...rest] = s;
console.log(first, rest.length, rest[0], rest[2]);
const [x, ...more] = u;
console.log(x, more.length, more[0], more[1]);
