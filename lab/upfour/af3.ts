function* gen(): Generator<number> { yield 1; }
const xs = Array.from({ length: 2 }, () => gen());
console.log(xs.length);
