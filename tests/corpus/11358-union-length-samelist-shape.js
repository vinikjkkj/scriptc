// the sameList shape (mysql2 parser_cache.js:118): a union-typed list compared by length, then indexed
function sameList(a, b) {
  if (a.length !== b.length) {
    return false;
  }
  for (let i = 0; i < a.length; ++i) {
    if (a[i] !== b[i]) {
      return false;
    }
  }
  return true;
}
function pick(n) {
  if (n === 0) return ["x", "y"];
  return true;
}
console.log(sameList(pick(0), ["x", "y"]));
console.log(sameList(pick(0), ["x", "z"]));
console.log(sameList(pick(1), true));
console.log(sameList(["x"], pick(0)));
