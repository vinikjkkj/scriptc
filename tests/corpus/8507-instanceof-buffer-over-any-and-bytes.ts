// `x instanceof Buffer` over an any operand, a bytes value and a union
// (pg-protocol's writeValues, pg's prepareValue).
function kind(v: any): string {
  if (v == null) return "null";
  if (v instanceof Buffer) return "buf" + v.length;
  if (v instanceof Date) return "date";
  if (v instanceof Error) return "err";
  return typeof v;
}
console.log(kind(Buffer.from("ab")), kind(new Date(0)), kind(new Error("x")), kind("s"), kind(null), kind({}));

function viaUnion(v: Buffer | string): string {
  return v instanceof Buffer ? "B" + v.length : "S" + v;
}
console.log(viaUnion(Buffer.from("xyz")), viaUnion("q"));

const plain = new Uint8Array([1, 2, 3]);
const buf = Buffer.from([1, 2, 3]);
console.log(plain instanceof Buffer, buf instanceof Buffer);
