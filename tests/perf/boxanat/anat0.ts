// Control: same sources, NO boxing. The delta between anat1 and anat0 is
// the box's own cost.
interface Inner { a: number; b: string; }
interface Ev { id: string; n: number; inner: Inner; tags: string[]; }

const N = 1000;
const sources: Ev[] = [];

function makeEv(i: number): Ev {
  return { id: "m" + i, n: i, inner: { a: i, b: "x" + i }, tags: ["t1", "t2"] };
}

for (let i = 0; i < N; i++) {
  sources.push(makeEv(i));
}
console.log(sources.length + " 0");
