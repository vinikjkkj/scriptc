type R = { done: boolean; value: number | undefined; tag: string };
function mk(n: number): R {
  if (n < 2) return { value: n, done: false, tag: "a" };
  if (n < 4) return { tag: "b", done: true, value: n };
  return { done: true, value: undefined, tag: "c" };
}
for (const n of [1, 2, 4]) {
  const r = mk(n);
  console.log(Object.keys(r), Object.values(r), Object.entries(r));
  for (const k in r) console.log("in", k);
}
