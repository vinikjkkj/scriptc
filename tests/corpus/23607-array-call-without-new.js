// `Array(n)` without `new` is the same constructor: a length-n array of HOLES (ioredis fills
// such an array by index; a program may also read the holes before it does).
const a = Array(3);
console.log(a, a.length, 0 in a);
for (let i = 0; i < a.length; i++) a[i] = i * 2;
console.log(a, 0 in a);
const b = Array(4);
b[2] = "x";
console.log(b, 1 in b, 2 in b);
console.log(Array(), Array(0), Array("3"), Array(2.0));
const args = Array(5);
console.log(args.length, args.map(() => 1), Object.keys(args));
const filled = Array(3).fill(0);
console.log(filled, 0 in filled);
try { Array(-1); } catch (e) { console.log(e.name, e.message); }
try { Array(2.5); } catch (e) { console.log(e.name, e.message); }
console.log(Array(2) instanceof Array, Array.isArray(Array(2)));
