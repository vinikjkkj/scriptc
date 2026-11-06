type R = { done: boolean; value: number | undefined; tag: string };
function mk(n: number): R {
  if (n < 2) return { value: n, done: false, tag: "a" };
  return { tag: "b", done: true, value: n };
}
const a = mk(1), b = mk(2);
const { done, ...ra } = a; const { done: d2, ...rb } = b;
console.log(ra, rb, JSON.stringify(rb), Object.keys(rb), done, d2);
const { tag, ...rc } = b; console.log(rc, JSON.stringify(rc));
