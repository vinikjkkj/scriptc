// An ARRAY whose elements are Maps or Sets -- a per-dictionary token table
// is a `ReadonlyMap<string, number>[]`.
//
// The storage was already there: ScrArr keeps every non-scalar element as a
// ref, and scr_map_retain_v/release_v are the SAME adapters a Map VALUE and
// an index-signature overflow already use for a nested container. This is
// that argument one container out.
//
// Two tables had to agree, and missing the second is what a partial change
// looks like: the element KIND (SCR_ELEM_REF) alone builds an array with no
// element adapters, so `elem_retain` is NULL and the first store segfaults.
// arrNewC's useRef list is what makes construction go through
// scr_arr_new_ref, which stores the retain/release/trace triple.
//
// LLVM refuses this construct (SC3001) and the default build falls back to
// C -- the same standing tier gap as the other ref-element kinds there.

// exercita refcount: push, sobrescrita, drop, aninhamento
const rows: Map<string, number>[] = [];
for (let i = 0; i < 3; i++) { const m = new Map<string, number>(); m.set("k", i); rows.push(m); }
console.log(rows.length, rows[0]?.get("k"), rows[2]?.get("k"));
rows[1] = new Map([["k", 99]]);
console.log(rows[1]?.get("k"), rows.length);
const shared = new Map([["s", 1]]);
const a1: Map<string, number>[] = [shared, shared];
shared.set("s", 2);
console.log(a1[0]?.get("s"), a1[1]?.get("s"));
const nested: Set<string>[][] = [[new Set(["x"])], [new Set(["y"]), new Set(["z"])]];
console.log(nested.length, nested[1]?.length, nested[1]?.[1]?.has("z"));
const popped = rows.pop();
console.log(popped?.get("k"), rows.length);
