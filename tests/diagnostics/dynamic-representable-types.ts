/* COMPOSITE types the dynamic engine represents but the static surface
 * does not — `any[]`, records and functions with `any`-typed members, the
 * evolving `const arr = []`: each site reports the SC2011 dynamic-family
 * choice ("runs in the embedded dynamic engine"), proved by re-running the
 * type mapping with the engine enabled — never the generic supported-types
 * recitation. Bare `any` keeps its own SC2011 arm (the stronger stay-static
 * hint: 'unknown' + a checked cast); types with NO dynamic representation
 * (an optional-element tuple) keep the SC2001 recitation. */
const arr: any[] = [1, "x"];
var evolving = []; // never used — the tsc-clean evolving-array shape
const rec = { workItem: {} as any, width: "10px" }; // compiles: an any member of a record literal in an unannotated variable is the checked-dynamic slot
const vals = Object.values(rec); // any[] from a CALL: still no static representation
const fn: (v: any) => string = (v) => String(v);
const bare: any = 41;
const optTuple: [number, string?] = [1];
console.log(arr.length, rec.width, vals.length, fn(1), bare, optTuple.length);
export const marker: number = 1;
