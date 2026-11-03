// The lru.min shape: number[] tables that grow with `.length = n`, are indexed past what was
// written, and are only ever read through indexes the program wrote -- plus `Array<number>(n)`.
const max = 6;
const next: number[] = [];
const prev: number[] = [];
next.length = max;
prev.length = max;
let head = 0;
let tail = 0;
let size = 0;
function push(index: number): void {
  if (size === 0) {
    head = tail = index;
  } else {
    next[tail] = index;
    prev[index] = tail;
    tail = index;
  }
  size++;
}
push(2);
push(4);
push(1);
console.log(head, tail, size, next, prev);
console.log(next[2], next[4], next[1], 0 in next, 2 in next, next.length);
console.log(next.filter((v) => v !== undefined), prev.reduce((p, v) => p + v, 0));
next.length = 3;
console.log(next, next.length);
next.length = 5;
console.log(next, Object.keys(next));
const grid: number[] = Array<number>(5);
for (let i = 0; i < grid.length; i++) grid[i] = i * i;
console.log(grid, 0 in grid);
const holey: number[] = new Array(4);
console.log(holey, holey.length, holey.map((v) => v + 1), holey.reduce((p, v) => p + v, 7));
const sums: number[] = new Array(3).fill(0);
sums[1] += 5;
console.log(sums);
