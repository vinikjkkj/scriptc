const a = new BigInt64Array([3n, -1n, 2n, 9007199254740993n]);
const u = new BigUint64Array([18446744073709551615n, 0n, 5n]);
console.log(a.at(-1), a.at(0), a.at(10), u.at(0), u.at(-3));
console.log(a.join("-"), a.join(), u.join(" | "), a.toString(), u.toString(), new BigInt64Array(0).join());
console.log(a.map(x => x * 2n), u.map(x => x + 1n));
console.log(a.toReversed(), a, u.toReversed());
console.log(a.with(0, 5n), a.with(-1, 7n), u.with(1, 18446744073709551616n));
try { a.with(9, 1n); } catch (e) { console.log((e as Error).name, (e as Error).message); }
const r = new BigInt64Array([1n, 2n, 3n]);
console.log(r.reverse(), r === r.reverse());
console.log(a.find(x => x > 2n), a.find(x => x > 99n), a.findLast(x => x < 0n), a.findIndex(x => x === 2n), a.findLastIndex(x => x > 100n));
console.log(a.filter(x => x > 0n), a.reduce((p, x) => p + x, 0n), a.reduce((p, x) => p + x), a.reduceRight((p, x) => p - x));
a.forEach((x, i) => console.log(i, x));
console.log(a.every(x => x > -5n), a.some(x => x > 5n), u.every((x, i, arr) => arr.length === 3));
console.log(a.includes(2n), a.indexOf(9007199254740993n), a.lastIndexOf(3n));
console.log(a.toSorted(), a.toSorted((p, q) => (q > p ? 1 : -1)), [...a.values()], [...a.entries()]);
console.log(a.toLocaleString(), a.slice(1, 3), a.subarray(2));
