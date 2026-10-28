// An accessor record stored in a Map<string, unknown> and read back through a checked cast answers its getters.
// Map value holding accessor record, read back through a checked cast
const m = new Map<string, unknown>();
function make(max: number) {
  let size = 0;
  return {
    get available(): number { return max - size; },
    get size(): number { return size; },
    add(): void { size++; },
  };
}
const c = make(4);
c.add();
m.set("k", c);
const got = m.get("k") as { available: number; size: number };
console.log(got.available, got.size);
