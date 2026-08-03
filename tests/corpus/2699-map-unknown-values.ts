// `Map<string, unknown>` -- a per-key bag of opaque payloads, which is what
// a plugin registry keeps its instances in.
//
// The overflow store of an index-signature record IS a string-keyed map and
// has carried dyn values since it existed, through the same ScrMap adapters
// and the same trace fixpoint. So a user Map holding one is the identical
// storage under a different spelling -- the argument the nested-container
// case already makes.
//
// The STORE side is what compiles: set, has, delete, size, keys, iteration,
// and holding the map inside another container. Reading a value out INTO A
// BINDING still fences, because a dyn local has no static representation --
// a separate rule, untouched here. That is the whole surface the motivating
// code uses: it sets an instance under a key and deletes it on dispose,
// never reading one back typed.
const bag = new Map<string, unknown>();

bag.set("n", 42);
bag.set("s", "hi");
bag.set("o", { a: 1 });
bag.set("arr", [1, 2, 3]);
bag.set("b", true);
bag.set("nil", null);

console.log(bag.size);
console.log(bag.has("n"), bag.has("nil"), bag.has("absent"));

// Overwriting a key replaces the value and does not grow the map.
bag.set("n", 43);
console.log(bag.size);

// delete answers whether the key was there, and shrinks it.
console.log(bag.delete("s"), bag.delete("s"));
console.log(bag.size);

// Key order is insertion order, and survives the overwrite above.
console.log([...bag.keys()].join(","));

let seen = 0;
bag.forEach(() => {
  seen += 1;
});
console.log(seen);

// The map inside another container: the nested-container storage this
// leans on, one level up.
const outer = new Map<string, Map<string, unknown>>();
outer.set("inner", bag);
console.log(outer.size, outer.get("inner")?.size);

const inSet = new Set<string>();
for (const k of bag.keys()) inSet.add(k);
console.log(inSet.size, inSet.has("arr"));

bag.clear();
console.log(bag.size, outer.get("inner")?.size);
