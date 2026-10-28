// for-in and the in operator see an accessor as an own enumerable key; for-in does not run the getter.
let calls = 0;
function make(max: number) {
  let size = 0;
  return {
    get available(): number { calls++; return max - size; },
    n: 7,
    add(): void { size++; },
  };
}
const c = make(2);
const u: unknown = c;
for (const k in u as object) console.log("key", k);
console.log("in", "available" in (u as object), calls);
console.log(calls);
