// The replacer's key argument is the member name, or the index as a string
// for an element, at every depth.
const walk: unknown = { a: { b: [{ c: 1 }, { c: 2 }] }, d: 3 };
const keys: string[] = [];
const out = JSON.stringify(walk, (k: string, v: unknown) => {
  keys.push(k);
  return v;
}, 1);
console.log(out);
console.log(keys.join(","));
