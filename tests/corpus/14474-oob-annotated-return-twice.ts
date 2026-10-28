// Two out-of-range reads through the same declared-union return, in a loop.
function at(a: number[], i: number): number | undefined {
  return a[i];
}
const xs: number[] = [10, 20];
let misses = 0;
for (let i = 0; i < 4; i++) {
  if (at(xs, i) === undefined) misses++;
}
console.log("misses", misses, at(xs, 3));
