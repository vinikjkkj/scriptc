// Array.from(d) over untyped sources whose kind is decided at run time: nullish
// sources throw V8's not-iterable TypeError (both spellings), a number or a
// boolean answers [], a DataView (no iterator, no length) answers [], a typed
// array answers its elements, and a function answers one undefined per declared
// parameter (its arity).
function from(src) {
  return Array.from(src);
}
function fromMapped(src) {
  return Array.from(src, (v) => v);
}
function tryIt(label, f) {
  try {
    const r = f();
    console.log(label, "ok", JSON.stringify(r));
  } catch (e) {
    console.log(label, "threw", e instanceof TypeError, e.message);
  }
}
tryIt("undef", () => from(undefined));
tryIt("null", () => from(null));
tryIt("undef-mapped", () => fromMapped(undefined));
tryIt("null-mapped", () => fromMapped(null));
tryIt("number", () => from(5));
tryIt("bool", () => from(false));
tryIt("dataview", () => from(new DataView(new ArrayBuffer(3))));
tryIt("u8", () => from(new Uint8Array([7, 8])));
tryIt("fn-arity", () => from(function (a, b) {}));
tryIt("fn-noargs", () => from(() => 1));
