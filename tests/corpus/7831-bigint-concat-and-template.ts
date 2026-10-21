// Concatenation and interpolation of a bigint print its digits, no `n` suffix,
// exactly as String(n) and n.toString() always did.
function a(x: bigint): string { return `${x}`; }
function b(x: bigint): string { return x + ""; }
function c(x: bigint): string { return "" + x; }
function d(x: bigint): string { return "n=" + x + ";" + `<${x}>`; }
function e(x: bigint): string { return String(x) + x.toString(); }
for (const v of [0n, 5n, -123456789012345678901234567890n, 2n ** 70n]) {
  console.log(a(v), b(v), c(v), d(v), e(v));
}
