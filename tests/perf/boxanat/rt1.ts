// Round-trip probe: cross into `unknown`, recover at the same static type.
// Establishes the CURRENT semantics the fix must preserve.
interface Inner { a: number; b: string; }
interface Ev { id: string; n: number; inner: Inner; tags: string[]; }

const kept: unknown[] = [];

function box(e: Ev): void { kept.push(e); }
function unbox(i: number): Ev { return kept[i] as Ev; }

const src: Ev = { id: "m0", n: 1, inner: { a: 1, b: "x" }, tags: ["t1"] };
box(src);
box(src);                       // a SECOND crossing of the same source
const back0 = unbox(0);
const back1 = unbox(1);
console.log("back0===src " + (back0 === src));
console.log("back1===src " + (back1 === src));
console.log("back0===back1 " + (back0 === back1));
src.n = 42;                     // mutate the source AFTER the crossing
console.log("after mutate, back0.n=" + unbox(0).n);
console.log("kept[0]===kept[1] " + (kept[0] === kept[1]));
