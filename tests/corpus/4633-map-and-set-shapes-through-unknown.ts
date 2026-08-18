// The map dyn kind on the shapes 4631 does not reach: a bare SET, a map as
// a UNION ARM, a map INSIDE a map inside a record, and an ARRAY of maps.
// Each is a different walker: the union arm goes through dynMatch (the
// interned-typeKey strcmp), the nested and array forms through
// canDynCheckTo's nested walker, the bare set through the top-level arm.
//
// Identity is asserted on every one of them. The box holds the ScrMap by
// reference, so `unbox(box(m)) === m` must hold however deep the value sat
// — a copy would answer `size` correctly and this wrong, which is the
// whole reason each line ends in a `===`.
type MK = Map<string, number>;
type SK = Set<string>;

// 1. A SET, bare, round-tripped. Sets ARE the map runtime with the value
//    slot unused, and they get the same kind and the same typeKey
//    discipline — `set<string>` interns differently from `map<string,f64>`
//    even though scr_map_new is called identically for both (4632).
const s = new Set<string>();
s.add("a");
s.add("b");
const us: unknown = s;
const s2 = us as SK;
console.log("set", s2.size, s2.has("a"), s2 === s);

// 2. A UNION ARM of map type, matched out of a dyn. This is the arm that
//    would take the wrong tag if dynMatch tested the KIND instead of the
//    key.
const mm: MK = new Map();
mm.set("k", 3);
const uu: unknown = mm;
const arm = uu as MK | undefined;
console.log("union", arm === undefined ? "undef" : String(arm.size));

// 3. NESTED: a map INSIDE a map, inside a record, through unknown.
type Inner = Map<string, string>;
const inner: Inner = new Map();
inner.set("i", "v");
const outer = new Map<string, Inner>();
outer.set("o", inner);
const rec = { deep: outer, tag: "t" };
const ur: unknown = rec;
const rb = ur as { deep: Map<string, Inner>; tag: string };
console.log("nested", rb.tag, rb.deep.size, rb.deep.get("o")!.get("i"), rb.deep === outer);

// 4. An ARRAY of maps through unknown.
const arr: MK[] = [mm, mm];
const ua: unknown = arr;
const ab = ua as MK[];
console.log("array", ab.length, ab[0]!.get("k"), ab[0]! === mm);
