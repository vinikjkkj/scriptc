// Every numeric operator over a boolean that reached the program through an
// unknown value: ToNumber(true) is 1 and ToNumber(false) is 0, in unary -, +,
// ~, in + (with a number), in - * / % **, in the bitwise six, and in the
// relational operators against a number or another boolean.
function ops(value, flag) {
  const b = typeof value === 'boolean' ? value : flag;
  return [
    -b, +b, ~b,
    b + 1, b - 1, b * 3, b / 2, b % 1, b ** 2,
    b & 1, b | 2, b ^ 3, b << 2, b >> 1, b >>> 0,
    b < 2, b <= 0, b > 0, b >= 1,
    b + b, b < b, b > false,
  ];
}
console.log(ops(true, false).join(' '));
console.log(ops(false, true).join(' '));
