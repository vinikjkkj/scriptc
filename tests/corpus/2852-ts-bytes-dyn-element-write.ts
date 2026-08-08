// The element-write coercions a typed array performs when the write
// arrives through an 'unknown'-typed (dyn) parameter: exactly the static
// tier's ToNumber/wrap rules, plus JS's silent no-op for an index that is
// out of range (an integer-indexed exotic object never throws there).
function set(buf: any, i: number, v: any): void {
  buf[i] = v;
}
function peek(buf: any, i: number): boolean {
  return buf[i] === undefined;
}
const u = new Uint8Array(4);
set(u, 0, 300);
set(u, 1, -1);
set(u, 2, 2.9);
set(u, 3, NaN);
console.log("coerced", u[0], u[1], u[2], u[3]);
set(u, 10, 5);
console.log("oob ignored", u.length, peek(u, 10));
const b = Buffer.alloc(2);
set(b, 0, 65);
set(b, 1, 322);
console.log("buffer", b[0], b[1], b.length);
