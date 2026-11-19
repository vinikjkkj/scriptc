// `w.constructor` of Object("x") / Object(1) / Object(true) reads as the builtin (String / Number / Boolean), `constructor` is in the wrapper,
// and an own member named constructor wins. (Identity against the global, `=== String`, is a separate open defect and is not asserted here.)
const s: any = Object("x");
const n: any = Object(1);
const b: any = Object(true);
console.log(typeof s.constructor, typeof n.constructor, typeof b.constructor);
console.log("constructor" in s, "constructor" in n, "constructor" in b);
console.log(s.constructor.name, n.constructor.name, b.constructor.name);
const o: any = Object("y");
o.constructor = 7;
console.log(o.constructor, typeof o.constructor, "constructor" in o);
const plain: any = JSON.parse('{"a":1}');
console.log(typeof plain.constructor, typeof plain.toString, "toUpperCase" in plain, typeof plain.toUpperCase, "toFixed" in plain);
