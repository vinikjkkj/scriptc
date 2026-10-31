// The value forms' TypeErrors and RangeErrors, and their order: ToIndex(bits)
// first (RangeError), then ToBigInt(value) (TypeError), each with Node's text.
const f = BigInt.asUintN;
const g = BigInt.asIntN;
const cases = [
  () => f(64, 5),
  () => f(-1, 5n),
  () => g(2 ** 53, 1n),
  () => g("8", 3n),
  () => g(1.9, 3n),
  () => g(NaN, 3n),
  () => f(1n, 5n),
  () => f(64, null),
  () => f(64, undefined),
  () => f(64, "12"),
  () => f(64, true),
  () => f(-1, 5),
  () => f(2 ** 53, 5),
];
for (const thunk of cases) {
  try {
    console.log("ok", String(thunk()));
  } catch (e) {
    console.log(e.constructor.name, e.message);
  }
}
try {
  console.log([1n, 2n].map(BigInt.asUintN).map((x) => String(x)).join(","));
} catch (e) {
  console.log(e.constructor.name, e.message);
}
console.log([5n, -1n].map((v) => f(3, v)).map((x) => String(x)).join(","));
