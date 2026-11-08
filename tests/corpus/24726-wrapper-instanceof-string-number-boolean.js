// A primitive wrapper object is an instance of its constructor, with or without a subclass in the program.
const s = Object("hello");
const n = Object(5);
const b = Object(false);
console.log(s instanceof String, s instanceof Number, s instanceof Boolean);
console.log(n instanceof Number, n instanceof String, b instanceof Boolean, b instanceof Number);
console.log(Object(s) === s, Object(n) === n);
function probe(p) { return [p instanceof String, p instanceof Number, p instanceof Boolean].join(""); }
console.log(probe("a"), probe(1), probe(true), probe(null), probe(undefined), probe({}), probe([]), probe(() => 1), probe(Object("a")), probe(Object(1)));
function isString(x) { return typeof x === "string" || x instanceof String; }
console.log(isString("a"), isString(s), isString(n), isString({}));
const w = Object.create(String.prototype);
console.log(w instanceof String, Object.create(Number.prototype) instanceof Number, Object.create(null) instanceof Boolean);
