// The result of a function whose JSDoc scalar claim its body contradicts (it can return undefined) bound by const, let and var, and read through
// operators, templates and conditions: the binding holds the dynamic value, so Node's undefined survives instead of tripping the claimed number.
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
// const / let / var bindings of the call
const c1 = parse("12"), c2 = parse("toolong");
let l1 = parse("7"); let l2 = parse("nope");
var v1 = parse("x");
console.log(c1, c2, l1, l2, v1, typeof c2, c2 === undefined, l2 === undefined);
l1 = parse("zzzzz");
console.log(l1, typeof l1);
l2 = 5;
console.log(l2 + 1);
// reads of the bindings in operators and conditions
console.log(c2 + 1, c1 + 1, c2 || "dflt", c1 || "dflt", c2 ? "t" : "f", c2 == null, c2 ?? "nn");
console.log(`${c2}|${c1}`, "s" + c2, String(c2));
// direct use of the call
console.log(parse("zzzzz") + 1, parse("zzzzz") === undefined, parse("4") * 3, `${parse("toolong")}`);
