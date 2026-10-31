// Guarded `.call` (narrowed by the check) and the brand-check idiom: the baseline shape that already
// lowers, kept beside the unguarded rows so a regression in either is visible.
function isArr(v) {
  return v instanceof Array;
}
function tag(a) {
  return [this.k, a];
}
function pick(flag) {
  return flag ? tag : undefined;
}
const f = pick(true);
if (f) console.log(f.call({ k: 7 }, "yes"));
const g = pick(false);
if (g) console.log(g.call({ k: 8 }, "no"));
console.log(isArr([]), isArr({}));
