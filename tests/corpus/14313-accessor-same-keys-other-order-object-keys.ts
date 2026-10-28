// Two literals with the same keys and the accessor in a different position: Object.keys, JSON and the shape's identity follow each literal's own order.
// same keys, different accessor position: Object.keys must follow the literal
function make1(max: number) {
  let size = 0;
  return { get a(): number { return max + size; }, b: 2, add(): void { size++; } };
}
function make2(max: number) {
  let size = 0;
  return { b: 2, get a(): number { return max + size; }, add(): void { size++; } };
}
const x: unknown = make1(1);
const y: unknown = make2(1);
console.log(Object.keys(x as object), Object.keys(y as object));
console.log(JSON.stringify(x), JSON.stringify(y));
