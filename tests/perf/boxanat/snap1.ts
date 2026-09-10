// Is a box a SNAPSHOT or a REFERENCE? Mutate the source after the crossing
// and read the box DYNAMICALLY (never through a cast back to the type).
interface Ev { id: string; n: number; }

const kept: unknown[] = [];
const src: Ev = { id: "m0", n: 1 };
kept.push(src);
src.n = 42;
src.id = "CHANGED";
console.log("dyn read after mutate: " + JSON.stringify(kept[0]));
const o = kept[0] as Record<string, unknown>;
console.log("keyed read: n=" + String(o["n"]) + " id=" + String(o["id"]));
