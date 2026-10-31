const T = TypeError;
console.log("typeof", typeof T);
try { JSON.parse("null").x; } catch (e) {
  console.log("a", e.constructor === T, T === e.constructor, e.constructor.name);
  console.log("b", e.constructor === TypeError);
}
