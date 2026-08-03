// `.map()` whose callback returns a Map (or a Set).
//
// ScrArr stores a Map by reference like any other refcounted element --
// the same nested-container storage a Map VALUE and an index-signature
// overflow already use -- and an array of them builds fine through push.
// The `.map()` gate excluded the two anyway, so the one spelling that
// could not produce such an array was the one that reads best.

const ROWS: readonly (readonly string[])[] = [["a", "b"], ["c", "d", "e"]];

const maps = ROWS.map((row) => {
  const m = new Map<string, number>();
  for (let i = 0; i < row.length; i += 1) m.set(row[i], i);
  return m;
});

console.log(maps.length, maps[0].size, maps[1].size);
console.log(maps[0].get("a"), maps[0].get("b"), maps[1].get("e"));

// The Set twin of the same shape.
const sets = ROWS.map((row) => {
  const s = new Set<string>();
  for (const v of row) s.add(v);
  return s;
});
console.log(sets.length, sets[0].size, sets[1].size, sets[1].has("d"));

// Reading back through the array, and mutating a held Map.
maps[0].set("z", 99);
console.log(maps[0].size, maps[0].get("z"));

let total = 0;
for (const m of maps) total += m.size;
console.log(total);
