// A refinement member written in a loop and read after each write, then written again before a final read.
const e = new Error('loop') as Error & { n: number };
for (let i = 0; i < 4; i++) {
  e.n = i * 2;
  console.log(i, e.n, e.message);
}
e.n = 9;
console.log(e.n + 1);
