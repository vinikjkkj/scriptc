// The same question through an `unknown` slot -- a DIFFERENT lowering, and
// it was wrong in the same direction.
//
// A dyn value's `instanceof Uint8Array` is a kind compare on the boxed
// node, and SCR_DYN_BYTES carries DataViews too (they map to bytes<u8>).
// The kind compare alone answered `true` for a boxed DataView. The test
// now reads the payload's flavor as well; `bytes` keeps its meaning for
// every narrowing extraction that only wants "this dyn holds u8".
function kindOf(u: unknown): string {
  if (u instanceof Uint8Array) return `bytes:${u.length}`;
  if (u instanceof ArrayBuffer) return `buffer:${u.byteLength}`;
  if (typeof u === "string") return `string:${u.length}`;
  return "other";
}

const owner = new Uint8Array([5, 6, 7, 8]);
console.log(kindOf(owner));
console.log(kindOf(new DataView(owner.buffer)));
console.log(kindOf(Buffer.from([1, 2])));
console.log(kindOf("hi"));
console.log(kindOf(42));

// The narrow still bridges: the true branch reads through the extraction,
// and it is only reached by values the test actually admitted.
function sumBytes(u: unknown): number {
  if (!(u instanceof Uint8Array)) return -1;
  let total = 0;
  for (let i = 0; i < u.length; i++) total += u[i]!;
  return total;
}
console.log(sumBytes(owner), sumBytes(new DataView(owner.buffer)));
