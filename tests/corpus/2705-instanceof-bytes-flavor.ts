// `x instanceof Uint8Array` / `instanceof ArrayBuffer` -- the test that
// DISCRIMINATES a `string | ArrayBuffer | Uint8Array` slot, and the reason
// those two map to distinct bytes flavors rather than sharing one type.
// Mapping them together would have been cheaper and would have made this
// test undecidable; the value side is what redeems that choice.
//
// The runtime answer is the union TAG: each flavor is its own arm, so the
// test is which arm the value carries. A NARROWED operand decides
// statically instead -- after the other arms are ruled out its type IS the
// answer -- and it arrives as a unionNarrow wrapping the read rather than a
// bare read, which is still pure, so folding it drops no evaluation.

// A discriminacao que motivou dar tipo distinto ao ArrayBuffer.
function send(data: string | ArrayBuffer | Uint8Array): string {
  if (typeof data === "string") return `s:${data}`;
  if (data instanceof Uint8Array) return `u8:${data.length}`;
  if (data instanceof ArrayBuffer) return `ab:${data.byteLength}`;
  return "?";
}
const u = new Uint8Array([1, 2, 3]);
console.log(send("hi"), send(u));

// so Uint8Array no braco, e a ordem invertida
function kind(x: string | Uint8Array): string {
  return x instanceof Uint8Array ? `bytes:${x.length}` : `str:${x.length}`;
}
console.log(kind("abcd"), kind(u));
