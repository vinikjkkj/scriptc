// String(u), u === 5 and u.method(...) over an unknown local: the local is read where it lives while the other operands run calls (one reassigns an outer variable, one reassigns the local itself).
function conv(u: unknown): string {
  return String(u) + "/" + String(u);
}
function eqCall(u: unknown, k: () => number): boolean {
  return u === k();
}
function eqReassign(): string {
  let u: unknown = 5;
  const same = u === (u = 6, 5);
  return same + ":" + String(u);
}
function invokeArgs(): string {
  let chunk: any = new Uint8Array([1, 2, 3, 4, 5]);
  const r = chunk.subarray((chunk = new Uint8Array([9, 9]), 1), 3);
  return r.length + ":" + r[0] + ":" + chunk.length;
}
let outer = 0;
console.log(conv(42), conv("s"), conv(null), conv([1, 2]), eqCall(7, () => { outer++; return 7; }), eqCall("x", () => 1), outer, eqReassign(), invokeArgs());
