// A CYCLIC value crossing into an `unknown` slot. The crossing deep-copies,
// and a cyclic value has no finite copy, so scr_dyn_from_enter traps on
// re-entry. This records WHERE that trap fires today.
interface Chain { name: string; next?: Chain; }

const a: Chain = { name: "a" };
a.next = a;

console.log("built the cycle");
const u: unknown = a;          // <-- the crossing
console.log("crossed: " + typeof u);
