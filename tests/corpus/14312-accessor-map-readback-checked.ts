// An accessor record stored in a Map<string, unknown> reads back through JSON and Object.keys; a checked cast into a data record that names the getters is refused (diagnostics/accessor-crossing-cast-into-data-record-refused.ts).
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
console.log(JSON.stringify(m.get("k")));
console.log(Object.keys(m.get("k") as object));
