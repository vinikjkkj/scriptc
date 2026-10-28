// An object-literal getter crossing into unknown is read live: the dyn accessor calls the captured getter, and the static record's data members still answer.
function createCounter(max: number) {
  let size = 0;
  return {
    get available(): number { return max - size; },
    get size(): number { return size; },
    add(): void { size++; },
  };
}
const c = createCounter(3);
c.add();
const u: unknown = c;
const box = new Map<string, unknown>();
box.set("k", u);
console.log(JSON.stringify(box.get("k")));
console.log(Object.keys(box.get("k") as object));
