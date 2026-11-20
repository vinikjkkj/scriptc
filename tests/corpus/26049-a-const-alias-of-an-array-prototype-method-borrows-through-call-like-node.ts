// A const alias of an Array.prototype method borrows through .call over an array-like object and a string in TypeScript like Node.
const slice = Array.prototype.slice;
const join = Array.prototype.join;
const like: ArrayLike<number> = { length: 3, 0: 1, 1: 2, 2: 3 };
console.log(slice.call(like, 1).join(), join.call(like, "-"), join.call("abc", "."));
