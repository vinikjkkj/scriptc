// Anatomy probe: retain N boxed records; sources stay alive in a parallel
// typed array, so the census sees ONLY the boxes' own materialisation.
interface Inner { a: number; b: string; }
interface Ev { id: string; n: number; inner: Inner; tags: string[]; }

const N = 1000;
const sources: Ev[] = [];
const boxes: unknown[] = [];

function makeEv(i: number): Ev {
  return { id: "m" + i, n: i, inner: { a: i, b: "x" + i }, tags: ["t1", "t2"] };
}

for (let i = 0; i < N; i++) {
  const e = makeEv(i);
  sources.push(e);
  boxes.push(e);
}
console.log(sources.length + " " + boxes.length);
