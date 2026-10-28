// Object.values over a crossed accessor record runs the getter in key order.
let calls = 0;
function make(max: number) {
  let size = 0;
  return {
    first: "a",
    get available(): number { calls++; return max - size; },
    n: 7,
    add(): void { size++; },
  };
}
const c = make(3);
c.add();
const u: unknown = c;
console.log(Object.values(u as object));
console.log(calls);
