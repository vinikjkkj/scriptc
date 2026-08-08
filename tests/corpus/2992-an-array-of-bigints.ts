// bigint elements are refcounted heap digits (scr_big_retain_v/release_v,
// no trace), so `bigint[]` is the ordinary ref element. This used to abort
// the C emitter with an internal assertion.
const xs: bigint[] = [1n, 2n, 3n];
console.log(xs.length, String(xs[0]), String(xs[1]), String(xs[2]));

xs.push(9007199254740993n);
xs.push(-42n);
console.log("after push", xs.length);
for (let i = 0; i < xs.length; i++) console.log(i, String(xs[i]));

let total = 0n;
for (let i = 0; i < xs.length; i++) total += xs[i]!;
console.log("sum", String(total));

const doubled: bigint[] = [];
for (let i = 0; i < xs.length; i++) doubled.push(xs[i]! * 2n);
console.log("doubled", doubled.map((b) => String(b)).join(","));

const big = xs[3]!;
console.log("indexOf", xs.indexOf(big), "includes", xs.includes(big));
console.log("popped", String(xs.pop()));
console.log("left", xs.length);
