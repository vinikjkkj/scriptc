// int_32.ts shape: unary `+` over a `number | string` parameter.
function toInt32(value: number | string): number {
  return +value | 0;
}
function reassigned(value: number | string): number {
  if (typeof value === "number") value = String(value);
  return +value | 0;
}
console.log(toInt32("3"), toInt32(4), toInt32("x"), toInt32("-7.9"));
console.log(reassigned(12), reassigned("0x10"), reassigned(2.7));
