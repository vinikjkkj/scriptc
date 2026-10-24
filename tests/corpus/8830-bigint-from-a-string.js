// BigInt(string): StringToBigInt, static and through an untyped operand.
const v = BigInt('4294967297');
console.log(v, typeof v, BigInt('  42\n'), BigInt(''), BigInt('   '), BigInt('-17'), BigInt('+5'));
console.log(BigInt('0x1F'), BigInt('0o17'), BigInt('0b101'), BigInt('0XfF'));
console.log(BigInt('123456789012345678901234567890') * 2n);
console.log(BigInt(' ﻿7 '));

function tryBig(x) {
  try { return String(BigInt(x)); } catch (e) { return e.name + ': ' + e.message; }
}
for (const s of ['12abc', '1.5', '1n', '1_0', '-0x1', '0x', '+', '-', '0xG', 'abc', ' 1 2 ']) console.log(JSON.stringify(s), tryBig(s));
const mixed = [5, true, false, '77', ' 0x10 ', null, undefined, 1.5];
for (const m of mixed) console.log(typeof m, tryBig(m));
console.log(tryBig(7n), tryBig([9]), tryBig(['3']), tryBig([]), tryBig({}), tryBig([1, 2]));
function f(value, bits) { return BigInt.asUintN(bits, BigInt(value)); }
console.log(f(-5, 16), f('300', 8), BigInt.asIntN(32, BigInt('4294967297')));
console.log(Number(BigInt.asIntN(32, BigInt('4294967297') >> BigInt(32))));
