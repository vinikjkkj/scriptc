// A refinement member written in a loop and read after each write.
const e = new Error('loop') as Error & { n: number };
for (let i = 0; i < 4; i++) {
  e.n = i * 2;
  console.log(i, e.n, e.message);
}
console.log(e.n + 1);
