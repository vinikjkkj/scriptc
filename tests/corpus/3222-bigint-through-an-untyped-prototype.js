// The zapo shape, in JavaScript: protobufjs bundles `long`, and `long`'s
// bigint surface is three expressions that all needed the checked-dynamic
// bigint kind before any of them could lower.
//
//     S.toBigInt = function () {
//       var e = BigInt(this.low >>> 0);
//       return BigInt(this.unsigned ? this.high >>> 0 : this.high) << BigInt(32) | e;
//     };
//     n.fromBigInt = function (e, u) {
//       return fromBits(Number(BigInt.asIntN(32, e)),
//                       Number(BigInt.asIntN(32, e >> BigInt(32))), u);
//     };
//     n.fromValue  = function (e, u) {
//       return typeof e === "bigint" ? n.fromBigInt(e, u) : d(e, u);
//     };
//
// Four separate facts are load-bearing here, and three of them are only
// visible in an UNTYPED file, which is why this fixture is .js:
//
//   1. `S.toBigInt = function () { ... }` assigns a `() => bigint` into a
//      checked-dynamic member. That is the crossing itself.
//   2. `BigInt(<untyped>)` is ToBigInt over a dyn -- and over a
//      CONDITIONAL, which is the spelling that widens to the island
//      unless the position asks for a dyn.
//   3. `e >> BigInt(32)` mixes a dyn with a bigint. JS refuses to mix, so
//      an expression that runs at all has bigints on both sides; the
//      checked cast makes that proof at runtime. Answering the ToNumber
//      way instead would silently produce a NUMBER here.
//   4. `typeof e === "bigint"` is the DISPATCH. It used to fold to the
//      constant `false` -- correct while no bigint could reach a dyn, and
//      a silent wrong branch the moment one could. This is the line that
//      decides whether a real bigint is decoded as a bigint or as a
//      number, so the program below runs BOTH arms and prints both.

function Long(low, high, unsigned) {
  this.low = low | 0;
  this.high = high | 0;
  this.unsigned = !!unsigned;
}

var S = Long.prototype;

S.toBigInt = function () {
  var e = BigInt(this.low >>> 0);
  return BigInt(this.unsigned ? this.high >>> 0 : this.high) << BigInt(32) | e;
};

S.toString = function () {
  return String(this.toBigInt());
};

var N = {};

N.fromBits = function (lo, hi, u) {
  return new Long(lo, hi, u);
};

N.fromBigInt = function (e, u) {
  return N.fromBits(Number(BigInt.asIntN(32, e)), Number(BigInt.asIntN(32, e >> BigInt(32))), u);
};

N.fromNumber = function (n, u) {
  return N.fromBits(n % 4294967296, Math.floor(n / 4294967296), u);
};

// The dispatch. `e` is untyped, so this is the guard over a dyn.
N.fromValue = function (e, u) {
  return typeof e === "bigint" ? N.fromBigInt(e, u) : N.fromNumber(e, u);
};

// --- the round trip, both directions -------------------------------

var a = new Long(0x89abcdef | 0, 0x01234567, false);
console.log("toBigInt:", String(a.toBigInt()));
console.log("toString:", a.toString());

// Split a bigint back into halves and rebuild -- the fromBigInt path.
var b = N.fromBigInt(a.toBigInt(), false);
console.log("rebuilt low/high:", b.low, b.high);
console.log("rebuilt:", b.toString());
console.log("same value:", b.toBigInt() === a.toBigInt());

// The dispatch takes the BIGINT arm for a bigint...
var viaBig = N.fromValue(a.toBigInt(), false);
console.log("fromValue(bigint):", viaBig.toString());
// ...and the NUMBER arm for a number. A folded `typeof === "bigint"`
// would send the first of these down the second path.
var viaNum = N.fromValue(66051, false);
console.log("fromValue(number):", viaNum.toString());

// The unsigned flag changes which half is read unsigned.
var u1 = new Long(0xffffffff | 0, 0xffffffff | 0, true);
var s1 = new Long(0xffffffff | 0, 0xffffffff | 0, false);
console.log("u64 max:", u1.toString());
console.log("i64 -1: ", s1.toString());

// Zero, and the sign boundary at 2^31 in the high half.
console.log("zero:", new Long(0, 0, false).toString());
console.log("2^31 high:", new Long(0, 0x80000000 | 0, true).toString());
console.log("2^31 high signed:", new Long(0, 0x80000000 | 0, false).toString());

// asIntN / asUintN directly over an untyped operand, which is the
// original refusal: `BigInt.asIntN(number, unknown)`.
function lowHalf(e) {
  return Number(BigInt.asIntN(32, e));
}
function highHalf(e) {
  return Number(BigInt.asIntN(32, e >> BigInt(32)));
}
console.log("halves:", lowHalf(a.toBigInt()), highHalf(a.toBigInt()));

// And the untyped guard used the way a library uses it -- as a
// capability test whose two arms produce different types.
function describe(v) {
  if (typeof v === "bigint") return "bigint:" + String(v);
  if (typeof v === "number") return "number:" + String(v);
  if (typeof v === "string") return "string:" + v;
  return "other";
}
console.log(describe(a.toBigInt()));
console.log(describe(7));
console.log(describe("z"));
console.log(describe(true));
