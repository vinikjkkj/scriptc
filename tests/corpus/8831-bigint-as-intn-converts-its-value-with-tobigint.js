const v = BigInt('4294967297');
console.log(BigInt.asIntN(32, v), BigInt.asUintN(32, v), BigInt.asIntN(8, 255n), BigInt.asUintN(64, -1n));
console.log(Number(BigInt.asIntN(32, v >> BigInt(32))));
function f(value, bits) { return BigInt.asUintN(bits, BigInt(value)); }
console.log(f(-5, 16), f('300', 8));
function g(x, bits) { try { return String(BigInt.asIntN(bits, x)); } catch (e) { return e.name + ': ' + e.message; } }
console.log(g(5, 8), g(true, 8), g(false, 8), g('300', 8), g('0x1ff', 8), g(7n, 8), g(null, 8), g(undefined, 8), g('x', 8), g(1.5, 8), g([6], 8), g({}, 8), g('', 8));
const n = 5;
const s = '12';
try { console.log(BigInt.asUintN(8, n)); } catch (e) { console.log(e.name + ': ' + e.message); }
console.log(BigInt.asUintN(8, s), BigInt.asIntN(4, true));
