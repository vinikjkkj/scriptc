// A record with bytes and function members, converted to a narrower one, is the same object: the callee's writes (a byte, a replaced function) are the caller's reads.
interface Wide { name: string; data: Uint8Array; cb: () => number; extra: number }
interface Narrow { data: Uint8Array; cb: () => number }
function use(n: Narrow): number {
  n.data[0] = 9;
  return n.cb();
}
function swap(n: Narrow): void {
  n.cb = () => 99;
}
const w: Wide = { name: "w", data: new Uint8Array([1, 2]), cb: () => 7, extra: 3 };
console.log(use(w), w.data[0]);
swap(w);
console.log(w.cb(), w.name, w.extra);
