// Index arguments of methods called on an untyped array or byte array follow
// ToIntegerOrInfinity(ToNumber(x)): a string parses, true is 1, null is 0.
'use strict';
function show(f) {
  try {
    console.log(JSON.stringify(f()));
  } catch (e) {
    console.log(e.name + ': ' + e.message);
  }
}
function arr(a) {
  show(() => a.slice('1'));
  show(() => a.slice(true));
  show(() => a.slice(null));
  show(() => a.slice('1', '3'));
  show(() => a.slice('-1'));
  show(() => a.slice('abc'));
  show(() => a.slice(' 1 '));
  show(() => a.at('1'));
  show(() => a.at(true));
  show(() => a.splice('1', '1'));
  show(() => a);
  show(() => a.fill(0, '1', '2'));
  show(() => a.toSpliced('1', '1'));
  show(() => a.with('0', 5));
}
arr(JSON.parse('[1,2,3,4]'));
function bytes(u) {
  const part = u.slice('1');
  let s = '';
  for (let i = 0; i < part.length; i++) s += part[i] + ',';
  show(() => s);
  show(() => u.at('1'));
  show(() => u.at(false));
}
bytes(new Uint8Array([7, 8, 9]));
bytes(Buffer.from([7, 8, 9]));
