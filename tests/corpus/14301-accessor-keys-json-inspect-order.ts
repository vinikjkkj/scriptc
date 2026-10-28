// Accessors keep their literal position among data keys in JSON.stringify and console.log ([Getter]); the getter runs once per JSON read and never for console.log.
// key order: accessors interleaved with data keys, then the surfaces
let calls = 0;
function make(max: number) {
  let size = 0;
  return {
    first: "a",
    get available(): number { calls++; return max - size; },
    n: 7,
    get size(): number { return size; },
    last: true,
    add(): void { size++; },
  };
}
const c = make(3);
c.add();
const u: unknown = c;
console.log(JSON.stringify(u));
console.log(calls);
console.log(u);
console.log(calls);
