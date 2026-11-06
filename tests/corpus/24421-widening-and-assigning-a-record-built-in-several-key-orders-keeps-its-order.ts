type R = { done: boolean; value: number | undefined; tag: string };
function mk(n: number): R {
  if (n < 2) return { value: n, done: false, tag: "a" };
  return { tag: "b", done: true, value: n };
}
const a = mk(1), b = mk(2);
const u: unknown = b; console.log(u, JSON.stringify(u));
const oa = Object.assign({}, a), ob = Object.assign({}, b); console.log(oa, ob, JSON.stringify(ob));
