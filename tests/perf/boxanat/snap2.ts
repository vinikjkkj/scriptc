// ONE box, TWO answers. A static-to-dyn crossing copies; the recovery hands
// the ORIGIN back. So after the source is mutated, recovering at the static
// type sees the new value and reading the same box dynamically sees the old.
interface Ev { id: string; n: number; }

const kept: unknown[] = [];
const src: Ev = { id: "m0", n: 1 };
kept.push(src);

src.n = 42;

const viaCast = kept[0] as Ev;
const viaKey = (kept[0] as Record<string, unknown>)["n"];
console.log("recovered at the static type: " + String(viaCast.n));
console.log("read through the box:         " + String(viaKey));
console.log("JSON of the box:              " + JSON.stringify(kept[0]));
console.log("agree? " + String(viaCast.n === Number(viaKey)));
