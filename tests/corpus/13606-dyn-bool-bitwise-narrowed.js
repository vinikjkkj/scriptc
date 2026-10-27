// Bitwise operators over a boolean reached through an unknown value: ToInt32
// of true is 1 and of false is 0. The operand is narrowed by typeof, so the
// boolean arrives statically typed, not as a dyn.
function enc(value) {
  switch (typeof value) {
    case 'boolean':
      value = value | 0;
      return value;
    case 'number':
      return value;
    default:
      return -1;
  }
}
function xor(value) {
  if (typeof value === 'boolean') return (value ^ 3) << 1;
  return -2;
}
console.log(enc(true), enc(false), enc(5), enc("x"), xor(true), xor(false), xor(1));
