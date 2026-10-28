// A `number | undefined` parameter receives an out-of-range read: the callee
// tests the miss against undefined.
function show(v: number | undefined): string {
  return v === undefined ? "none" : "v" + v;
}
const n: number[] = [1];
console.log(show(n[5]));
console.log(show(n[0]));
