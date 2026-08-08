// Math.pow, Math.log, the Math constants — and the `**` operator, which
// is the SAME spec operation as Math.pow and was answering C's values.
//
// ECMA-262's Number::exponentiate is not C's pow() in three places, and
// all three are reachable from ordinary code:
//   pow(1, NaN)            C says 1.0,  JS says NaN
//   pow(-1, +Infinity)     C says 1.0,  JS says NaN
//   pow(-1, -Infinity)     C says 1.0,  JS says NaN
// The exponent-is-zero rule comes FIRST in both (`NaN ** 0` is 1), which
// is why the guards have to be ordered and not merely present.
//
// Math.log is the opposite case: C log() IS the JS function at every edge
// the spec names, so the only thing that was missing was the table entry.
// And Math's number constants are literals — `Math.PI` needed --dynamic
// and `Math.LN2` fell through to the library fence, both by accident of a
// table that listed two of the eight.
//
// The three of them arrive together because a protobuf float codec is
// built out of them: `Math.pow(2, e - 150)` denormalizes a float32
// mantissa and `Math.floor(Math.log(x) / Math.LN2)` recovers its exponent.

function show(label, value) {
  console.log(label + " -> " + String(value));
}

// ── Math.pow and `**` must agree, value by value, including the edges ───
function pair(label, a, b) {
  var viaFn = Math.pow(a, b);
  var viaOp = a ** b;
  console.log(
    label + ": " + String(viaFn) +
    (Object.is(viaFn, viaOp) ? "" : "  MISMATCH ** => " + String(viaOp)),
  );
}

// The three C disagreements.
pair("1 ** NaN", 1, NaN);
pair("(-1) ** Infinity", -1, Infinity);
pair("(-1) ** -Infinity", -1, -Infinity);
pair("1 ** Infinity", 1, Infinity);
pair("1 ** -Infinity", 1, -Infinity);
// …and the zero-exponent rule that must still win over a NaN base.
pair("NaN ** 0", NaN, 0);
pair("NaN ** -0", NaN, -0);
pair("Infinity ** 0", Infinity, 0);
// A NaN base with a live exponent is NaN.
pair("NaN ** 2", NaN, 2);
pair("NaN ** NaN", NaN, NaN);

// Signed zeros: the odd-integer exponent keeps the sign.
pair("(-0) ** 3", -0, 3);
pair("(-0) ** 2", -0, 2);
pair("(-0) ** -3", -0, -3);
pair("(-0) ** -2", -0, -2);
pair("(+0) ** 3", 0, 3);
pair("(+0) ** -3", 0, -3);
console.log("(-0) ** 3 is -0: " + Object.is(Math.pow(-0, 3), -0));
console.log("(-0) ** 2 is +0: " + Object.is(Math.pow(-0, 2), 0));

// Infinite bases.
pair("Infinity ** 2", Infinity, 2);
pair("Infinity ** -2", Infinity, -2);
pair("(-Infinity) ** 3", -Infinity, 3);
pair("(-Infinity) ** 2", -Infinity, 2);
pair("(-Infinity) ** -3", -Infinity, -3);
console.log("(-Infinity) ** -3 is -0: " + Object.is(Math.pow(-Infinity, -3), -0));

// A finite base with an infinite exponent, on both sides of |1|.
pair("2 ** Infinity", 2, Infinity);
pair("2 ** -Infinity", 2, -Infinity);
pair("0.5 ** Infinity", 0.5, Infinity);
pair("0.5 ** -Infinity", 0.5, -Infinity);

// A negative base with a fractional exponent is NaN — no principal root.
pair("(-8) ** (1/3)", -8, 1 / 3);
pair("(-2) ** 0.5", -2, 0.5);
pair("(-2) ** 3", -2, 3);

// Ordinary values, and the ones the float codec actually asks for.
pair("2 ** 10", 2, 10);
pair("2 ** 0.5", 2, 0.5);
pair("10 ** -3", 10, -3);
pair("2 ** -1074", 2, -1074);
pair("2 ** 1024", 2, 1024);
pair("2 ** -150", 2, -150);

// `**` is right-associative, and `**=` is the same operation.
console.log(2 ** 3 ** 2, (2 ** 3) ** 2);
var acc = 1;
acc **= NaN;
show("1 **= NaN", acc);
acc = 3; acc **= 4; show("3 **= 4", acc);

// ── Math.log at every edge the spec names ───────────────────────────────
show("log(1)", Math.log(1));
console.log("log(1) is +0: " + Object.is(Math.log(1), 0));
show("log(0)", Math.log(0));
show("log(-0)", Math.log(-0));
show("log(-1)", Math.log(-1));
show("log(-Infinity)", Math.log(-Infinity));
show("log(Infinity)", Math.log(Infinity));
show("log(NaN)", Math.log(NaN));
show("log(E)", Math.log(Math.E));
show("log(2)", Math.log(2));
show("log(1e308)", Math.log(1e308));
show("log(5e-324)", Math.log(5e-324));

// ── the constants, as literals ──────────────────────────────────────────
console.log(Math.PI, Math.E, Math.LN2, Math.LN10);
console.log(Math.LOG2E, Math.LOG10E, Math.SQRT2, Math.SQRT1_2);
// Each one's exact double, so a drifted table cannot hide behind toString.
console.log(Math.PI === 3.141592653589793, Math.LN2 === 0.6931471805599453);
console.log(Math.SQRT1_2 * Math.SQRT2, Math.LOG2E * Math.LN2);

// ── Math.clz32, the ToUint32 count ──────────────────────────────────────
console.log(Math.clz32(0), Math.clz32(1), Math.clz32(2), Math.clz32(-1));
console.log(Math.clz32(2147483648), Math.clz32(4294967295), Math.clz32(4294967296));
console.log(Math.clz32(NaN), Math.clz32(Infinity), Math.clz32(-Infinity));
console.log(Math.clz32(3.9), Math.clz32(-3.9), Math.clz32(1e21));

// ── the float32 codec these three exist for ─────────────────────────────
// pbjs's writeFloat_ieee754 fallback, verbatim in shape: recover the
// exponent with log/LN2, denormalize the mantissa with pow.
function f32bits(value) {
  var sign = value < 0 ? 1 : 0;
  if (sign) value = -value;
  if (value === 0) return [sign, 0, 0];
  if (isNaN(value)) return [0, 255, 1];
  if (value > 3.4028234663852886e38) return [sign, 255, 0];
  var exponent = Math.floor(Math.log(value) / Math.LN2);
  var mantissa = Math.round(value * Math.pow(2, -exponent) * 8388608) & 8388607;
  return [sign, exponent + 127, mantissa];
}
console.log(f32bits(1).join(","));
console.log(f32bits(-2.5).join(","));
console.log(f32bits(0.1).join(","));
console.log(f32bits(3.4028234663852886e38).join(","));
console.log(f32bits(0).join(","), f32bits(-0).join(","));

// Untyped operands take the same operation: the `**` a dyn slot computes
// is the same runtime entry, so the edges cannot diverge by lane.
function dynPow(a, b) { return a ** b; }
console.log(dynPow(1, NaN), dynPow(-1, Infinity), dynPow(2, 10), dynPow("3", "2"));
