// `Object(x)` over an untyped value, the two shapes ioredis' dependencies use: `Object(options).spread` (standard-as-callback,
// null and undefined read as an empty object) and `object = Object(object)` followed by writes (lodash's defaults: the result IS
// the argument when it is an object, a fresh empty object when it is null or undefined).
function mode(options) {
  if (options !== undefined && Object(options).spread) return "spread";
  return "plain";
}
console.log(mode({ spread: true }), mode({}), mode(null), mode(undefined), mode({ spread: 0 }));
function fill(object) {
  object = Object(object);
  object.k = 1;
  return object;
}
const own = { a: 1 };
fill(own);
console.log(own.k, JSON.stringify(own), JSON.stringify(fill(null)), JSON.stringify(fill(undefined)));
function viaCall(f) { return Object(f).name; }
console.log(viaCall(function named() {}), viaCall(null), viaCall(undefined), viaCall({ name: "n" }));
