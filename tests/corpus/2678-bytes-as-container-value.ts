// Byte buffers as CONTAINER values: a Map value and an index-signature
// record's value. A buffer is refcounted and holds no references, so it is
// the regex story exactly -- nothing to trace, no cycle to reach.
const m = new Map<string, Uint8Array>();
m.set("a", new Uint8Array([1, 2, 3]));
m.set("b", new Uint8Array([9]));

// Overwrite: the old buffer's reference is dropped, the new one retained.
m.set("a", new Uint8Array([4, 5]));

const a = m.get("a");
console.log(m.size, a === undefined ? -1 : a.length, a === undefined ? -1 : a[1]);

// Iteration order is insertion order, like Node's Map.
const parts: string[] = [];
for (const [k, v] of m) parts.push(`${k}:${v.length}`);
console.log(parts.join(","));

m.delete("b");
console.log(m.size, m.has("b"), m.has("a"));

// The index-signature form: the overflow store IS a string-keyed map, so the
// same value kind rides it.
const table: Record<string, Uint8Array> = {
  x: new Uint8Array([7, 7]),
  y: new Uint8Array([]),
};
table["z"] = new Uint8Array([1]);
const keys = Object.keys(table).sort();
console.log(keys.join(","), table["x"]!.length, table["y"]!.length, table["z"]![0]);

// Nested one level: a record member holding the map, which is the shape the
// appstate collection state arrives in.
type State = { readonly name: string; readonly indexValueMap: Map<string, Uint8Array> };
const st: State = { name: "critical", indexValueMap: m };
const v = st.indexValueMap.get("a");
console.log(st.name, v === undefined ? -1 : v[0]);
