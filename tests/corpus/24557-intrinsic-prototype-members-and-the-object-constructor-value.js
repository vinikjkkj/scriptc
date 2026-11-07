// The members an intrinsic prototype carries, read off the value Object.getPrototypeOf answers: Object.prototype's constructor,
// hasOwnProperty, isPrototypeOf, propertyIsEnumerable, toString, valueOf and toLocaleString as function values that bind their
// receiver (`proto.hasOwnProperty.call(o, k)`, `Object.prototype.toString.call(x)`), the Array prototype's constructor, and `Object`
// itself as a value in an equality test. The inherited methods are the very function values Object.prototype carries.
const o = { a: 1 };
function proto(x) { return Object.getPrototypeOf(x); }
const p = proto(o);
console.log(p.constructor === Object, p.hasOwnProperty.call(o, "a"), p.hasOwnProperty.call(o, "z"), p.hasOwnProperty.call(o, "toString"));
console.log(Object.prototype.toString.call([1]), Object.prototype.toString.call(null), Object.prototype.toString.call("s"), Object.prototype.toString.call(o), Object.prototype.toString.call(undefined), Object.prototype.toString.call(5), Object.prototype.toString.call(function () {}));
console.log(p.isPrototypeOf(o), p.isPrototypeOf([]), p.isPrototypeOf(Object.create(null)), p.propertyIsEnumerable.call(o, "a"), p.propertyIsEnumerable.call(o, "b"));
const ap = proto([]);
console.log(ap.constructor === Object, ap.hasOwnProperty === p.hasOwnProperty, typeof ap.constructor, ap.constructor.name, ap.isPrototypeOf([]), ap.isPrototypeOf({}));
console.log(typeof p.valueOf, p.valueOf.call(o) === o, typeof p.toLocaleString, p.toLocaleString.call(o), p.toString());
