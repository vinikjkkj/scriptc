// Every BigInt operation that ECMA-262 says raises a RangeError, caught.
//
// `big.div`, `big.rem`, `big.pow` and `big.fromF64` all raise a CATCHABLE
// RangeError in the runtime (scr_bigint.c: "Division by zero", "Exponent
// must be non-negative", "The number N cannot be converted to a BigInt
// because it is not an integer"). The whole `big.*` family sat OUTSIDE
// MAY_THROW_LIB_FNS, so the emitted call site had no pending-exception
// check: the throw stayed in the exception cell, the NULL/garbage result
// was used as the answer, and every `catch` here saw nothing. A deliberate
// runtime refusal turned into a wrong value — the worst pair available.
//
// The last line matters as much as the catches: with the seed missing, the
// pending exception is only noticed at the next check (or at exit), so the
// program's TAIL is what shows whether control flow survived the throw.
try {
  console.log(String(1n / 0n));
} catch (e) {
  console.log("div:", e.name, e.message);
}
try {
  console.log(String(7n % 0n));
} catch (e) {
  console.log("rem:", e.name, e.message);
}
try {
  console.log(String(2n ** -1n));
} catch (e) {
  console.log("pow:", e.name, e.message);
}
try {
  console.log(String(BigInt(1.5)));
} catch (e) {
  console.log("fromF64:", e.name, e.message);
}
try {
  console.log(String(BigInt(Infinity)));
} catch (e) {
  console.log("fromInf:", e.name, e.message);
}
try {
  console.log(String(BigInt(NaN)));
} catch (e) {
  console.log("fromNaN:", e.name, e.message);
}

// The non-throwing neighbours still answer, in the same frame.
console.log(String(6n / 3n), String(7n % 3n), String(2n ** 10n), String(BigInt(42)));

// And the throw must be observable as a value, not just as a printed line:
// a function that only divides is now a may-throw function, so its CALLER
// gets the unwind check too (the fixpoint half of the same defect).
function half(n) {
  return n / 0n;
}
function outer(n) {
  return half(n) + 1n;
}
let caught = 0;
try {
  outer(10n);
} catch {
  caught = 1;
}
console.log("propagated:", caught);
console.log("after");
