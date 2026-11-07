// A JSDoc scalar return claim ({Number}, {String}) with bare `return;` paths (ms's parse): JS hands the caller undefined there, so the
// return widens to the scalar or undefined and the claimed paths keep their values.
/**
 * Parse the given `str` and return milliseconds.
 *
 * @param {String} str
 * @return {Number}
 */
function parse(str) {
  str = String(str);
  if (str.length > 3) {
    return;
  }
  var match = /^(\d+)$/.exec(str);
  if (!match) {
    return;
  }
  var n = parseFloat(match[1]);
  return n * 2;
}
/** @return {String} */
function label(n) {
  if (n < 0) return;
  return "n" + n;
}
console.log(parse("12"), parse("12345"), parse("ab"), typeof parse("1"), typeof parse("123456"));
console.log(label(3), label(-1), typeof label(-1), parse("5") + 1, parse("zz") === undefined);
