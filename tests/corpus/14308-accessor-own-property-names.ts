// Object.getOwnPropertyNames lists the accessor name in declaration order.
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
console.log(Object.getOwnPropertyNames(u as object));
console.log(calls);
