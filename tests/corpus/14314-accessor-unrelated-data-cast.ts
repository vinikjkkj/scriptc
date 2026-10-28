// A checked cast into a data record whose field names are unrelated to the crossed accessor record's names: it is not a fence site, and it answers Node's values.
// an unrelated checked cast into a data record: the crossed accessor record's names (available, size) are not the target's fields
const m = new Map<string, unknown>();
function make(max: number) {
  let size = 0;
  return {
    id: 7,
    label: "L",
    get available(): number { return max - size; },
    get size(): number { return size; },
    add(): void { size++; },
  };
}
const c = make(4);
c.add();
m.set("k", c);
const got = m.get("k") as { id: number; label: string };
console.log(got.id, got.label);
