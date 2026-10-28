// Two literals with the same members in different order keep their own key order through the dyn crossing.
// two literals, same members, different key order, one shape crossing each
let calls = 0;
function make1(max: number) {
  let size = 0;
  return { get a(): number { calls++; return max; }, b: 1, add(): void { size++; } };
}
function make2(max: number) {
  let size = 0;
  return { b: 1, get a(): number { calls++; return max + size; }, add(): void { size++; } };
}
const x = make1(5);
const y = make2(6);
const ux: unknown = x;
const uy: unknown = y;
console.log(JSON.stringify(ux), JSON.stringify(uy));
console.log(ux);
console.log(uy);
console.log(calls);
