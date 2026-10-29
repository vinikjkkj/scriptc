// The webidl-conversions float converters (the shape whatwg-url uses), copied
// in structure from webidl-conversions' lib/index.js: toNumber over any value,
// then the finite and the unrestricted float conversions, the double
// conversion, and the error path. The float conversions build on Math.fround
// and on Object.is over the converted number. The edge inputs cover NaN, both
// zeros, both infinities, values past the float range, subnormal-range values,
// coercible and non-coercible values, a Symbol and a BigInt. The error class is
// fixed to TypeError here (every throw in the original is a TypeError); errors
// print their constructor and message. This is a JavaScript file on purpose:
// the real package is JavaScript, and its values are untyped.
function makeException(_ErrorType, message, options) {
  return new TypeError(`${options.context ? options.context : "Value"} ${message}.`);
}

function toNumber(value, options) {
  if (typeof value === "bigint") {
    throw makeException("TypeError", "is a BigInt which cannot be converted to a number", options);
  }
  return Number(value);
}

const floatConv = (value, options = {}) => {
  const x = toNumber(value, options);

  if (!Number.isFinite(x)) {
    throw makeException("TypeError", "is not a finite floating-point value", options);
  }

  if (Object.is(x, -0)) {
    return x;
  }

  const y = Math.fround(x);

  if (!Number.isFinite(y)) {
    throw makeException("TypeError", "is outside the range of a single-precision floating-point value", options);
  }

  return y;
};

const unrestrictedFloatConv = (value, options = {}) => {
  const x = toNumber(value, options);

  if (isNaN(x)) {
    return x;
  }

  if (Object.is(x, -0)) {
    return x;
  }

  return Math.fround(x);
};

const doubleConv = (value, options = {}) => {
  const x = toNumber(value, options);

  if (!Number.isFinite(x)) {
    throw makeException("TypeError", "is not a finite floating-point value", options);
  }

  return x;
};

function show(label, conv, v, options = {}) {
  try {
    const r = conv(v, options);
    console.log(label, r, Object.is(r, -0), Object.is(r, NaN));
  } catch (e) {
    console.log(label, "threw", e instanceof TypeError ? "TypeError" : "other", e.message);
  }
}

const inputs = [
  NaN, 0, -0, Infinity, -Infinity, 1.5, -1.5, 0.1, 3.4028234663852886e38,
  3.4028235677973366e38, 3.5e38, -3.5e38, 1e-46, -1e-46, 1e-40, 16777217,
  "1.25", "", " ", "abc", "Infinity", true, false, null, undefined, [], [4],
  { valueOf() { return 2.75; } },
];
for (const v of inputs) {
  show("float", floatConv, v);
  show("unrestricted float", unrestrictedFloatConv, v);
  show("double", doubleConv, v);
}
show("float bigint", floatConv, 3n);
show("unrestricted bigint", unrestrictedFloatConv, 3n);
show("float context", floatConv, Infinity, { context: "arg" });
