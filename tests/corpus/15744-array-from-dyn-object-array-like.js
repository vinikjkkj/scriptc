// Array.from(d) over untyped objects that have NO iterator: the array-like read
// (ToLength of `length`, then each index as Get(o, ToString(i)), a missing
// index undefined). Covers a plain record with a numeric length and a string
// length, a class instance without a length (answers []), a class instance
// whose declared `length` field is the only member (indices read undefined),
// and an instance with a length and an index-like member.
function from(src) {
  return Array.from(src);
}
class NoLength {
  constructor() {
    this.a = 1;
  }
}
class LengthOnly {
  constructor() {
    this.length = 2;
  }
}
class LengthAndIndex {
  constructor() {
    this.length = 2;
    this.first = "f";
  }
}
console.log("plain", JSON.stringify(from({ length: 3, 1: "m" })));
console.log("plain-no-length", JSON.stringify(from({ a: 1 })));
console.log("plain-string-length", JSON.stringify(from({ length: "2", 0: "x" })));
console.log("plain-fraction", JSON.stringify(from({ length: 2.9, 0: "z" })));
console.log("plain-negative", JSON.stringify(from({ length: -4 })));
console.log("class-no-length", JSON.stringify(from(new NoLength())));
console.log("class-length-only", JSON.stringify(from(new LengthOnly())));
console.log("class-length-and-field", JSON.stringify(from(new LengthAndIndex())));
