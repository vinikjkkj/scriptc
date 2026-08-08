// A Number PREDICATE static taken as a VALUE. protobufjs's util.js writes
// its integer test as
//
//     util.isInteger = Number.isInteger || function (value) { ... };
//
// which is a genuine VALUE position and not the capability test beside it:
// `||` yields an OPERAND, so the read escapes into `util.isInteger` and is
// CALLED afterwards. An opaque token that only answers the truthiness test
// would be a silent wrong answer here; the lowering hands back a real
// function over the same libCall the call form uses.
//
// The whole point of the quartet is that the ES2015 statics NEVER COERCE —
// `Number.isInteger("3")` is false, and `Number.isNaN("NaN")` is false where
// the ES5 GLOBAL isNaN says true. So every non-number kind answering false
// is the specified answer rather than a fallback, which is what makes a
// runtime kind test a complete implementation and not an approximation.
function pin(t) {
  t.isInteger = Number.isInteger || function (value) {
    return typeof value === "number" && isFinite(value) && Math.floor(value) === value;
  };
  return t;
}
const util = pin({});
console.log(util.isInteger(3), util.isInteger(3.5), util.isInteger("3"));

// The numeric edges, all four statics.
const isInt = Number.isInteger;
console.log(isInt(0), isInt(-0), isInt(1.5), isInt(NaN), isInt(Infinity), isInt(-Infinity));
console.log(isInt(9007199254740992), isInt(-7), isInt(1e21));

// Every other KIND. The statics do not coerce, so all of these are false —
// including the strings a ToNumber would have accepted.
console.log(isInt("3"), isInt(""), isInt(null), isInt(undefined), isInt(true), isInt([]), isInt({}));

const isFin = Number.isFinite;
const isNan = Number.isNaN;
const isSafe = Number.isSafeInteger;
console.log(isFin(1), isFin(NaN), isFin(Infinity), isFin("1"), isFin(null));
console.log(isNan(NaN), isNan(1), isNan("NaN"), isNan(undefined));
console.log(isSafe(9007199254740991), isSafe(9007199254740992), isSafe(1.5), isSafe("1"));

// The RECEIVER protocol, pinned rather than assumed: these are properties of
// the Number constructor whose algorithms read no `this`, so a detached call
// answers for its ARGUMENT no matter what receiver it is handed. (The
// String.prototype lifts are the opposite case — theirs must resolve an
// ambient receiver or answer for the wrong string.)
console.log(isInt.call(undefined, 4), isInt.call(null, 4.5), isInt.call("nope", 6));

// A function VALUE is truthy, so `f || g` is f and g never evaluates — JS's
// own rule for a truthy left operand, and what makes the protobufjs
// statement above yield the static rather than the hand-written fallback.
function mine(v) { return v > 0; }
function other(v) { return v < 0; }
const picked = mine || other;
console.log(picked(2), picked(-2));
