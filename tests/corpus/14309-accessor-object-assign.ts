// Object.assign copies an accessor's value by running its getter once.
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
const o = Object.assign({}, u as object); console.log(o);
console.log(calls);
