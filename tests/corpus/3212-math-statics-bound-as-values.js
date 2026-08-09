// A Math static bound once and called through the binding -- how a
// minifier spells any repeated builtin, and how the bundled `long`
// library spells Math.pow:
//
//     var pow = Math.pow;                  // long/umd/index.js
//     s = a <= 48 ? 1 : pow(2, a - 48);    // Long.prototype.divide
//     radixToPower = fromNumber(pow(radix, 6));
//
// A builtin lowers to a libCall at its CALL sites, so it had no closure to
// hand out and the bare member read fenced. It lifts to a real function
// now -- one per program per member, over the same libCall.
//
// The variadic pair KEEPS the fence: Math.max is declared
// `(...values: number[]) => number`, which is not the fixed-arity shape,
// and binarizing it silently would be wrong. (That refusal is fixtured in
// tests/diagnostics/stdlib.ts -- this program only shows that the CALL
// form still works next to the lifted values.)

var pow = Math.pow;
var floor = Math.floor;
var abs = Math.abs;
var round = Math.round;
var trunc = Math.trunc;
var ceil = Math.ceil;
var log = Math.log;
var clz32 = Math.clz32;

console.log(pow(2, 10), pow(2, -3), pow(2, 0.5), pow(-8, 2));
// The IEEE corners the operator and the function share.
console.log(pow(0, 0), pow(-1, Infinity), pow(NaN, 0), 1 / pow(-0, 3));
console.log(floor(-1.5), ceil(-1.5), round(2.5), round(-2.5), trunc(-2.7));
console.log(abs(-3), abs(-0) === 0, clz32(1), clz32(0));
console.log(log(Math.E), log(1), log(0), log(-1));

// The `long` shape: the binding crosses a function boundary.
function radixPow(r, n) {
  return pow(r, n);
}
console.log(radixPow(36, 6), radixPow(2, 0), radixPow(2, 48 - 48));

// A lifted value is a first-class function: passed, stored, re-read.
function apply2(f, x, y) {
  return f(x, y);
}
console.log(apply2(pow, 3, 4));
var table = { p: Math.pow, f: Math.floor };
console.log(table.p(5, 3), table.f(9.9));

// The same member read twice is the same lifted function (memoized per
// program) -- and calling BOTH must answer identically.
var pow2 = Math.pow;
console.log(pow(7, 2) === pow2(7, 2));

// The call forms are untouched, variadic ones included.
console.log(Math.pow(2, 8), Math.max(1, 2, 3), Math.min(4, 5), Math.floor(1.9));
