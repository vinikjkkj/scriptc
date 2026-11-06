/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-implied-eval -- the row builds engine code at run time on purpose */
// Hundreds of distinct engine objects and functions cross between the first and the second crossing of each: every one is still the same
// function the second time (the table that remembers them is bounded by what is alive, not by a count).
interface Hook { id: number; tag(): string }
const body = [
  "const objs = [], fns = [];",
  "for (let i = 0; i < n; i++) { objs.push({ id: i, tag() { return 't' + this.id; } }); fns.push(function () { return i; }); }",
  "for (let i = 0; i < n; i++) cb(objs[i], fns[i], 0);",
  "for (let i = 0; i < n; i++) cb(objs[i], fns[i], 1);",
  "return n;",
].join("\n");
const run = new Function("n", "cb", body) as (n: number, cb: (o: Hook, f: () => number, pass: number) => unknown) => unknown;
function round(n: number): number[] {
  const tags: unknown[] = [];
  const fs: unknown[] = [];
  let idx = 0;
  let sameTag = 0;
  let sameFn = 0;
  let distinct = 0;
  run(n, (o, f, pass) => {
    if (pass === 0) {
      tags.push(o.tag);
      fs.push(f);
      if (idx > 0 && tags[idx - 1] !== o.tag) distinct += 1;
      idx += 1;
    } else {
      if (tags[idx - n] === o.tag) sameTag += 1;
      if (fs[idx - n] === f) sameFn += 1;
      idx += 1;
    }
    return o.tag() + f();
  });
  return [sameTag, sameFn, distinct];
}
console.log(JSON.stringify([round(300), round(700)]));
