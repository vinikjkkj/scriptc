// The webidl-conversions `long long` shape: the width comes from a parameter,
// the operation is a value chosen by a flag, and the value is a bigint built
// from a number (BigInt(integerPart(x))). Untyped parameters, so every
// operand is checked-dynamic.
function createLongLongConversion(bitLength, { unsigned }) {
  const asBigIntN = unsigned ? BigInt.asUintN : BigInt.asIntN;
  return (value) => {
    let x = Number(value);
    if (!Number.isFinite(x) || x === 0) return 0;
    let xBigInt = BigInt(Math.trunc(x));
    xBigInt = asBigIntN(bitLength, xBigInt);
    return Number(xBigInt);
  };
}
const toU64 = createLongLongConversion(64, { unsigned: true });
const toI64 = createLongLongConversion(64, { unsigned: false });
const toI8 = createLongLongConversion(8, { unsigned: false });
const toU8 = createLongLongConversion(8, { unsigned: true });
console.log(toU64(5), toU64(-5), toI64(-5), toI64(2 ** 53 + 2), toI8(300), toU8(-1));
console.log(toU64(1e20), toI64(-1e20), toI8(0), toU8(NaN), toI8(Infinity));
const zero = createLongLongConversion(0, { unsigned: true });
console.log(zero(7), zero(-7));
