// `new Map(other)` where `other` is itself a map — the copy constructor.
//
// zapo's spelling is `WaAppStateSyncClient.ts:1469` — `const indexValueMap =
// new Map(baseMap)`, where `baseMap` is a `ReadonlyMap<string, Uint8Array>`
// parameter: the app-state sync loop takes a writable snapshot of the
// collection's index map before applying a mutation batch to it. It reported
// SC2020 'new Map(entries)'.
//
// The seed-array desugar (`new Map(pairs)` over a `[K, V][]` value) already
// existed. This is the same desugar with the array iterator swapped for the
// source map's own iteration primitives, so the ORDER story is the one JS
// gives: entries are drained in insertion order and set() in that order.
//
// The copy is SHALLOW, like JS: the two maps are different objects holding
// the same values. Both halves of that are asserted below, because getting
// either wrong is a silent wrong answer rather than a trap.

const base = new Map<string, number>();
base.set("a", 1);
base.set("b", 2);
base.set("c", 3);

const copy = new Map(base);
console.log(copy.size, [...copy.keys()].join(","), [...copy.values()].join(","));

// INDEPENDENCE, both directions. Writing through one map must not reach the
// other — a clone that aliased would print the mutation twice.
copy.set("d", 4);
console.log(base.size, copy.size, base.has("d"), copy.has("d"));
base.set("a", 99);
console.log(base.get("a"), copy.get("a"));
copy.delete("b");
console.log(base.has("b"), copy.has("b"));

// ORDER, after a delete and a re-insert on the SOURCE. JS moves a
// re-inserted key to the end, and the copy must drain the source's live
// entries in exactly the order the source holds them — not in the order the
// keys were first seen.
const ord = new Map<string, number>([["x", 1], ["y", 2], ["z", 3]]);
ord.delete("y");
ord.set("y", 20);
console.log([...ord.keys()].join(","));
console.log([...new Map(ord).keys()].join(","));

// TOMBSTONES. A source with holes left by deletes must copy only the live
// entries, at the right size.
const holed = new Map<string, number>();
for (let i = 0; i < 8; i += 1) holed.set(`k${i}`, i);
holed.delete("k0");
holed.delete("k3");
holed.delete("k7");
const holedCopy = new Map(holed);
console.log(holed.size, holedCopy.size, [...holedCopy.keys()].join(","));

// SHALLOW. Object values are the SAME objects, not copies of them — the
// mutation through the copy is visible through the source.
type Cell = { n: number };
const objs = new Map<string, Cell>([["p", { n: 1 }], ["q", { n: 2 }]]);
const objCopy = new Map(objs);
objCopy.get("p")!.n = 42;
console.log(objs.get("p")!.n, objCopy.get("p")!.n);
console.log(objs.get("q") === objCopy.get("q"));

// An empty source is an empty map, not a fence.
console.log(new Map(new Map<string, number>()).size);

// A ReadonlyMap parameter — zapo's actual receiver type — and a refcounted
// value type, so the clone's retain/release pairing is exercised.
function snapshot(src: ReadonlyMap<string, Uint8Array>): Map<string, Uint8Array> {
    return new Map(src);
}
const bytes = new Map<string, Uint8Array>([
    ["h1", new Uint8Array([1, 2])],
    ["h2", new Uint8Array([3])],
]);
const snap = snapshot(bytes);
snap.set("h3", new Uint8Array([4, 5, 6]));
console.log(bytes.size, snap.size, snap.get("h1")!.join(","), bytes.get("h1") === snap.get("h1"));

// The clone of a clone, inside a loop, so the helper is entered repeatedly
// and its temporaries are released each pass.
let rolling = new Map<string, number>([["seed", 0]]);
for (let i = 1; i <= 4; i += 1) {
    rolling = new Map(rolling);
    rolling.set(`n${i}`, i);
}
console.log(rolling.size, [...rolling.keys()].join(","));

// A number-keyed map, so the key type is not only string.
const nums = new Map<number, string>([[1, "one"], [2, "two"]]);
console.log([...new Map(nums).entries()].map(([k, v]) => `${k}=${v}`).join(","));
