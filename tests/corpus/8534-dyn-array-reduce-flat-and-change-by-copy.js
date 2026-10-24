// Array.prototype.reduce, reduceRight, flat, toReversed, toSorted, toSpliced and
// with over arrays the program holds untyped (the checked-dynamic tree), plus
// reduce/reduceRight/toReversed/toSorted/with over a Uint8Array and a Buffer.
// pg-connection-string: `Object.keys(x).reduce(...)`, `Object.entries(x).reduce(...)`.
'use strict';
function show(f) {
  try {
    const v = f();
    console.log(JSON.stringify(v));
  } catch (e) {
    console.log(e.name + ': ' + e.message);
  }
}
function run(a) {
  show(() => a.reduce((acc, x, i, arr) => acc + x + i + arr.length, 10));
  show(() => a.reduceRight((acc, x, i) => acc + ':' + x + i, 'z'));
  show(() => a.reduce((acc, x) => acc + x));
  show(() => a.reduceRight((acc, x) => acc + x));
  show(() => a.reduce(5));
  show(() => a.reduce((acc, x) => acc + x, undefined));
  show(() => a.toReversed());
  show(() => a.toSorted());
  show(() => a.toSorted((x, y) => y - x));
  show(() => a.toSorted(5));
  show(() => a.with(0, 99));
  show(() => a.with(-1, 77));
  show(() => a.with(10, 1));
  show(() => a.with(-10, 1));
}
run(JSON.parse('[3,1,2]'));
run(JSON.parse('[]'));
function nested(a) {
  show(() => a.flat());
  show(() => a.flat(0));
  show(() => a.flat(2));
  show(() => a.flat(Infinity));
  show(() => a.flat(-1));
  show(() => a.toSpliced(1, 2, 'a', 'b', 'c'));
  show(() => a.toSpliced());
  show(() => a.toSpliced(1));
  show(() => a.toSpliced(-1, 5));
  show(() => a);
}
nested(JSON.parse('[1,[2,[3,[4]]],5,[6]]'));
const keysReduced = Object.keys(JSON.parse('{"a":1,"b":2,"c":3}')).reduce((parsed, key) => parsed + key.toUpperCase(), '');
console.log(keysReduced);
function dump(x) {
  let out = '';
  for (let i = 0; i < x.length; i++) out += x[i] + ',';
  return out;
}
const bytesArr = (u) => {
  show(() => u.reduce((acc, x) => acc + x));
  show(() => u.reduceRight((acc, x, i) => acc + '-' + x + i, 'z'));
  show(() => dump(u.toReversed()));
  show(() => dump(u.toSorted()));
  show(() => dump(u.toSorted((a, b) => b - a)));
  show(() => dump(u.with(0, 300)));
  show(() => u.with(9, 1));
  show(() => u.toSorted(5));
  show(() => u.reduce(7));
};
bytesArr(JSON.parse('{"x":1}') && new Uint8Array([10, 9, 1]));
bytesArr(Buffer.from([3, 1, 2]));
const mixed = JSON.parse('[1,2,3]');
console.log(mixed.toSorted === undefined, mixed.length);
