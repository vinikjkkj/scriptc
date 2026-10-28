// hasOwn and in see an accessor as an own property; JSON.stringify runs the getter once.
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
console.log(String(JSON.stringify(u)), calls, Object.hasOwn(u as object, "available"), "available" in (u as object));
console.log(calls);
