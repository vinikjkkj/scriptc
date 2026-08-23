// `typeof` is the ONE read of an unbound name JavaScript does not throw
// on. Node erases `declare const`, `declare function` and `declare class`
// entirely, so those names are unbound at run time and `typeof` answers
// the STRING "undefined" — while every other read of the very same name
// is a ReferenceError.
//
// WHY THIS PROGRAM EXISTS: the compiler lowered the typeof operand like
// any other read, so the ambient-undefRead threw AT the `typeof` — one
// line before Node throws, and in a program like this one, which never
// touches the names any other way, where Node does not throw at all.
// Measured on both backends before the fix:
//
//     Node     before / typeof-const undefined / … / done      rc=0
//     scriptc  before                                          rc=1
//
// That is a program that exits 0 under Node and 1 under the compiler,
// with four lines of stdout missing. All three spellings are asserted
// here because they share one arm and a future widening could fix one.

declare const erasedConst: { readonly n: number };
declare function erasedFn(x: number): string;
declare class ErasedClass {
  readonly y: number;
}

console.log("before");

console.log("typeof-const", typeof erasedConst);
console.log("typeof-fn", typeof erasedFn);
console.log("typeof-class", typeof ErasedClass);

// Parenthesized: the operand is still a bare reference, so still
// "undefined".
console.log("typeof-parens", typeof erasedConst);

// The comparison spelling every environment sniff in the wild is written
// in. This is the shape that made the fold matter.
if (typeof erasedFn === "undefined") {
  console.log("sniff says absent");
} else {
  console.log("sniff says present");
}
console.log("sniff-inverted", typeof ErasedClass !== "undefined");

// THE OTHER DIRECTION — `typeof` must keep answering correctly for names
// that DO have a runtime. A fold that answered "undefined" for everything
// would satisfy the lines above.
const realNumber = 1;
const realString = "s";
function realFn(): number {
  return 2;
}
class RealClass {
  v = 1;
}
const realInstance = new RealClass();
console.log("real-number", typeof realNumber);
console.log("real-string", typeof realString);
console.log("real-fn", typeof realFn);
console.log("real-class", typeof RealClass);
console.log("real-instance", typeof realInstance);
console.log("real-undefined", typeof undefined);
console.log("stdlib-global", typeof JSON, typeof Math, typeof parseInt);

console.log("done");
