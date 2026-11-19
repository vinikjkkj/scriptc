// A Float64Array kernel that reads its operands into locals, writes one output element and then uses the locals again. With the output aliasing an operand
// (the same array, or two views of one buffer) the later uses must see the value read BEFORE the write, as in Node, not the element the write replaced.
function step(o: Float64Array, a: Float64Array): void {
  const x = a[0], y = a[1], z = a[2], w = a[3];
  o[0] = x + 1;
  o[1] = x * 2 + y;
  o[2] = y * 3 + z + x;
  o[3] = w - x - y - z;
}
function swap4(o: Float64Array, a: Float64Array): void {
  const a0 = a[0], a1 = a[1], a2 = a[2], a3 = a[3];
  o[0] = a3;
  o[1] = a2;
  o[2] = a1;
  o[3] = a0;
}
function show(o: Float64Array): string {
  let s = "";
  for (let i = 0; i < o.length; i++) s += String(o[i]) + " ";
  return s;
}
const m = new Float64Array([1, 2, 3, 4]);
step(m, m);
console.log("same", show(m));
const n = new Float64Array([5, 6, 7, 8]);
swap4(n, n);
console.log("swap", show(n));
const buf = new Float64Array([1, 2, 3, 4, 5, 6, 7]);
step(buf.subarray(1, 5), buf.subarray(0, 4));
console.log("views", show(buf));
swap4(buf.subarray(2, 6), buf.subarray(3, 7));
console.log("views2", show(buf));
const p = new Float64Array([1, 2, 3, 4]), q = new Float64Array(4);
step(q, p);
console.log("apart", show(p), show(q));
