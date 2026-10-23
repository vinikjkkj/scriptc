// The global isNaN / isFinite coerce their argument with ToNumber (unlike
// Number.isNaN / Number.isFinite): strings parse, null is 0, undefined is NaN.
// pgpass: `x = Number(x); return isFinite(x) && x > 0 && ...` over an untyped parameter.
'use strict';
function fin(x) { return isFinite(x); }
function nan(x) { return isNaN(x); }
const samples = [1, 0, -5.5, '2', ' 12 ', '0x10', '1e3', 'abc', '', null, undefined, true, false, Infinity, -Infinity, NaN, '42px'];
for (const s of samples) {
  console.log(String(s), fin(s), nan(s));
}
function validPort(x) {
  if (x === '*') return true;
  x = Number(x);
  return isFinite(x) && x > 0 && x < 9007199254740992 && Math.floor(x) === x;
}
console.log(validPort('5432'), validPort('*'), validPort('0'), validPort('1.5'), validPort('x'), validPort(undefined));
