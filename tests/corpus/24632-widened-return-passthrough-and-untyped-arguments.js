// The same widened function passed through: `return f(v)` and `const r = f(v); return r` widen the wrapper too, and the result goes to an untyped
// parameter or a binding unchanged (Node's undefined survives every hop).
/**
 * @param {String} str
 * @return {Number}
 */
function parse(str) {
  str = String(str);
  if (str.length > 3) return;
  var n = parseFloat(str);
  if (isNaN(n)) return;
  return n * 2;
}
const c2 = parse("toolong"), c1 = parse("12");
// passthrough return: the wrapper is widened too
function twice(v) { return parse(v); }
function viaLet(v) { const r = parse(v); return r; }
console.log(twice("21"), twice("toolong"), viaLet("5"), viaLet("toolong"));
const t1 = twice("toolong"); const t2 = twice("8");
console.log(t1, t2, typeof t1);
// an argument to an UNTYPED parameter
function show(x) { return typeof x + ":" + x; }
console.log(show(parse("toolong")), show(parse("3")), show(c2));
