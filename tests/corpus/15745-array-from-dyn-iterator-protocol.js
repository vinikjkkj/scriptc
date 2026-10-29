// Array.from(d) over untyped objects that DO carry a Symbol.iterator method: the
// method is called with the object as `this`, and next() is read until done.
// An object literal whose iterator is a plain method, a class instance whose
// iterator is a class method, and a null iterator, which falls back to the
// array-like read as JS does.
function from(src) {
  return Array.from(src);
}
const literal = {
  [Symbol.iterator]() {
    let i = 0;
    return {
      next() {
        i++;
        return i <= 2 ? { value: "v" + i, done: false } : { value: undefined, done: true };
      },
    };
  },
  length: 9,
  0: "ignored",
};
class Counted {
  constructor() {
    this.n = 3;
  }
  [Symbol.iterator]() {
    let i = 0;
    const n = this.n;
    return {
      next() {
        i++;
        return i <= n ? { value: i * 10, done: false } : { value: undefined, done: true };
      },
    };
  }
}
const nullIter = { [Symbol.iterator]: null, length: 2, 0: "z" };
console.log("literal", JSON.stringify(from(literal)));
console.log("class", JSON.stringify(from(new Counted())));
console.log("null-iterator", JSON.stringify(from(nullIter)));
