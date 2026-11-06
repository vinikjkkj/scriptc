type R = { done: boolean; value: number | undefined; tag: string };
function mk(n: number): R {
  if (n < 2) return { value: n, done: false, tag: "a" };
  if (n < 4) return { tag: "b", done: true, value: n };
  return { done: true, value: undefined, tag: "c" };
}
for (const n of [1, 2, 4]) { console.log(mk(n)); console.log(JSON.stringify(mk(n))); }
const arr = [mk(1), mk(2), mk(5)]; console.log(arr);
