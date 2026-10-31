// BigInt.asUintN / BigInt.asIntN read as VALUES, picked by a condition and
// then called. The long library's createLongLongConversion does exactly this:
// `const asBigIntN = unsigned ? BigInt.asUintN : BigInt.asIntN`.
function pick(u: boolean) {
  return u ? BigInt.asUintN : BigInt.asIntN;
}
const asUnsigned = pick(true);
const asSigned = pick(false);
const vals: bigint[] = [-5n, 5n, -(2n ** 70n) - 3n, 2n ** 130n + 7n, 0n, -1n, 2n ** 63n];
for (const w of [0, 1, 63, 64, 65, 128]) {
  for (const v of vals) {
    console.log(w, String(v), String(asUnsigned(w, v)), String(asSigned(w, v)));
  }
}
