// Object.keys lists an accessor name without running its getter; JSON and Object.entries run it once each.
let calls = 0;
function make(max: number) {
  let size = 0;
  return {
    first: "a",
    get available(): number { calls++; return max - size; },
    n: 7,
    get size(): number { return size; },
    add(): void { size++; },
  };
}
const c = make(3);
c.add();
const u: unknown = c;
console.log(Object.keys(u as object));
console.log(calls);
console.log(JSON.stringify(u), calls);
console.log(Object.entries(u as object).length, calls);
