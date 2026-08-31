const src = [1, 2, 3];
const xs = Array.from(src, (n) => JSON.parse(`{"n":${n}}`) as unknown);
console.log(xs.length);
