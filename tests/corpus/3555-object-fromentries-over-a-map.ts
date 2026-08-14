// `Object.fromEntries(m.entries())` and `Object.fromEntries(m)` over a
// string-keyed map.
//
// The pair-ARRAY source already lowered; the lib types the argument
// `Iterable<readonly [PropertyKey, T]>` and a map is one, so what the fence
// was actually refusing was the iterator, not the call. This is the same
// interned helper with the index loop swapped for the map's own iteration
// primitives — the Map.forEach contract: iterCount read fresh, iterLive to
// skip tombstones, iterEnter/iterExit inside a finally.
//
// zapo's spelling is `store/memory/appstate.store.ts:87` — serialising a
// `Map<string, Uint8Array>` index map into the exported store snapshot.
//
// NUMBER-keyed maps keep the fence: each key would need ToPropertyKey, and
// a canonical array index enumerates BEFORE the string keys in JS own-key
// order, which is a different rule with a different order story. The
// pair-array path fences the same way, so the two agree.

const m = new Map<string, number>();
m.set("b", 2);
m.set("a", 1);
m.set("c", 3);

const o = Object.fromEntries(m.entries());
console.log(o["a"], o["b"], o["c"]);
console.log(JSON.stringify(o));
console.log(Object.keys(o).join(","));

// The bare-map spelling is the same value.
console.log(JSON.stringify(Object.fromEntries(m)));

// ORDER is the map's insertion order, not sorted and not the order the keys
// were first mentioned in this file.
const ord = new Map<string, number>([["z", 1], ["y", 2], ["x", 3]]);
console.log(Object.keys(Object.fromEntries(ord)).join(","));

// A delete-then-reinsert on the source moves the key to the end, and the
// object must show that order too.
ord.delete("y");
ord.set("y", 20);
console.log(JSON.stringify(Object.fromEntries(ord)));

// TOMBSTONES: a source with holes contributes only its live entries.
const holed = new Map<string, number>();
for (let i = 0; i < 6; i += 1) holed.set(`k${i}`, i);
holed.delete("k0");
holed.delete("k4");
console.log(JSON.stringify(Object.fromEntries(holed)));

// An empty map is an empty object.
console.log(JSON.stringify(Object.fromEntries(new Map<string, number>())));

// The result is a FRESH object: writing into it must not reach the map, and
// setting the map afterwards must not reach the object.
const snap = Object.fromEntries(m);
snap["a"] = 111;
m.set("d", 4);
console.log(m.get("a"), snap["a"], m.size, Object.keys(snap).length);

// A refcounted value type — zapo's own — and identity: the object holds the
// map's own values, not copies of them (JS's fromEntries does not clone).
const bytes = new Map<string, Uint8Array>([
    ["h1", new Uint8Array([1, 2])],
    ["h2", new Uint8Array([3])],
]);
const outBytes = Object.fromEntries(bytes);
console.log(outBytes["h1"]!.join(","));
// IDENTITY, asserted as the observable fact rather than with ===: JS's
// fromEntries stores the map's own values, so a write through the object
// is visible through the map.
outBytes["h1"]![0] = 9;
console.log(bytes.get("h1")!.join(","));

// Through a function boundary, in a loop, so the helper is re-entered and
// its temporaries are released each pass.
function snapshotOf(src: Map<string, Uint8Array>): Record<string, Uint8Array> {
    return Object.fromEntries(src.entries());
}
for (let i = 0; i < 3; i += 1) {
    bytes.set(`gen${i}`, new Uint8Array([i, i + 1]));
    const s = snapshotOf(bytes);
    console.log(i, Object.keys(s).length, s[`gen${i}`]!.join(":"));
}

// A string-valued map, so the value slot is not only bytes.
const strs = new Map<string, string>([["one", "1"], ["two", "2"]]);
console.log(JSON.stringify(Object.fromEntries(strs)));

// The pair-ARRAY source that already worked, unchanged beside the new one.
console.log(JSON.stringify(Object.fromEntries([["p", 1], ["q", 2]] as [string, number][])));
