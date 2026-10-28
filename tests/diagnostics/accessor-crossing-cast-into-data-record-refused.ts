// A checked cast of an unknown that holds a crossed accessor record into a DATA record naming the getter ("available") is refused by name: the cast copies the getter at cast time, and a later change to the getter would be answered stale.
// dyn value cast back to a data-shaped record, then re-read after the source changes
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
m.set("k", c);
const got = m.get("k") as { available: number; size: number };
console.log(got.available, got.size);
c.add();
console.log(got.available, got.size);
c.add();
console.log(got.available, got.size);
