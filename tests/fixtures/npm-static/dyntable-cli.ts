// npm-static pilot: shorthand METHODS in a dyn object literal — the value
// half of esbuild's `__commonJS` module table, driven end to end so the
// lowered closures are a byte-for-byte claim against Node rather than only
// a compiled shape.
import dyntable from "dyntable";

console.log("double", dyntable.double(21));
console.log("negate", dyntable.negate(7));
console.log("varint0", dyntable.varint(0));
console.log("varint127", dyntable.varint(127));
console.log("varint128", dyntable.varint(128));
console.log("varint16384", dyntable.varint(16384));
console.log("varintneg", dyntable.varint(-1));
console.log("affine", dyntable.affine(3, 4));
console.log("tag", dyntable.tag());
console.log("twice", dyntable.twice(5));
console.log("zero", dyntable.zero(1));
console.log("named", dyntable.named(2));
console.log("order", dyntable.order(9));
