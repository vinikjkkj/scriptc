// A Map holding a CONTAINER: Map<string, Set<T>> (a per-key membership
// table) and Map<string, Map<K, V>>. The overflow store of an
// index-signature record has carried exactly these since it existed, through
// the same scr_map adapters and the same trace fixpoint -- a user Map holding
// one is the identical storage under a different spelling.
const byUser = new Map<string, Set<string>>();
byUser.set("a", new Set(["x", "y"]));
byUser.set("b", new Set<string>());

// The lookup answers `Set<T> | undefined`: a container arm beside a unit,
// where the unit tag test IS the narrowing.
const a = byUser.get("a");
console.log(byUser.size, a === undefined ? -1 : a.size, a === undefined ? false : a.has("y"));
console.log(byUser.get("zz") === undefined);

// Mutating through the read-back reference: the map stores the container by
// reference, like Node.
a?.add("z");
const again = byUser.get("a");
console.log(again === undefined ? -1 : again.size);

// Overwrite drops the old container's reference.
byUser.set("a", new Set(["only"]));
const replaced = byUser.get("a");
console.log(replaced === undefined ? -1 : replaced.size);

// Nested maps, the same rule one kind over.
const nested = new Map<string, Map<string, number>>();
nested.set("outer", new Map([["inner", 42]]));
const inner = nested.get("outer");
console.log(inner === undefined ? -1 : (inner.get("inner") ?? -1));

// The index-signature spelling, supported before this change -- kept as the
// control that both routes agree.
const tbl: Record<string, Set<string>> = { a: new Set(["z"]) };
console.log(tbl["a"]!.size);
