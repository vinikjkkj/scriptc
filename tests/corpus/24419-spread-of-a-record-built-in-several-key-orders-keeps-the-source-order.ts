type R = { done: boolean; value: number | undefined; tag: string };
function mk(n: number): R {
  if (n < 2) return { value: n, done: false, tag: "a" };
  return { tag: "b", done: true, value: n };
}
const a = mk(1), b = mk(2);
const sa = { ...a }, sb = { ...b };
console.log(sa, sb, JSON.stringify(sa), JSON.stringify(sb));
const p1 = { z: 0, ...a }, p2 = { z: 0, ...b };
console.log(p1, p2, JSON.stringify(p2), Object.keys(p2));
const q1 = { ...a, z: 0 }, q2 = { ...b, z: 0 };
console.log(q1, q2, JSON.stringify(q1));
for (const k in q2) console.log("in", k);
const cp: R = { ...a }; const cq: R = { ...b }; console.log(cp, cq, JSON.stringify(cq));
