// Object.getPrototypeOf over every kind of value, and the plain-object test ioredis' isPlainObject is built on:
// `proto === Object.prototype || proto === null`. Plain objects answer Object.prototype, a null-prototype dictionary null,
// Object.create(p) and a constructor's instance their own prototype, arrays/functions/class instances their intrinsic (the
// identity between two values of one kind holds, and differs across kinds), and null/undefined throw Node's TypeError.
function isPlainObject(value) {
  if (value === null || typeof value !== "object") return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}
class A { constructor() { this.a = 1; } }
class B { constructor() { this.b = 2; } }
function F() { this.f = 1; }
const own = { shared: true };
const child = Object.create(own);
const cases = [{}, { a: 1 }, [], null, Object.create(null), new A(), new F(), "str", 5, true, child, new Date(0), new Map(), function g() {}, undefined];
console.log(cases.map((v) => isPlainObject(v)).join(","));
console.log(Object.getPrototypeOf({}) === Object.prototype, Object.getPrototypeOf(Object.create(null)), Object.getPrototypeOf(child) === own);
console.log(Object.getPrototypeOf([]) === Object.getPrototypeOf([1, 2]), Object.getPrototypeOf([]) === Object.getPrototypeOf({}));
console.log(Object.getPrototypeOf(new A()) === Object.getPrototypeOf(new A()), Object.getPrototypeOf(new A()) === Object.getPrototypeOf(new B()));
console.log(Object.getPrototypeOf(new F()) === Object.getPrototypeOf(new F()), Object.getPrototypeOf(new F()) === Object.prototype);
console.log(typeof Object.getPrototypeOf(5), typeof Object.getPrototypeOf("s"), Object.getPrototypeOf(5) === Object.prototype);
for (const bad of [null, undefined]) {
  try { Object.getPrototypeOf(bad); } catch (e) { console.log(e.constructor.name + ": " + e.message); }
}
let chain = 0;
for (let p = Object.getPrototypeOf(child); p !== null && chain < 5; p = Object.getPrototypeOf(p)) chain++;
console.log(chain);
