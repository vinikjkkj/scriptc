// isPrototypeOf, propertyIsEnumerable and hasOwnProperty read off a checked-dynamic value of EVERY kind answer as Node does: an array's and a
// string's indices are enumerable, `length` is not, a number or boolean owns nothing, and null throws the property-read TypeError.
function t(f) { try { return String(f()); } catch (e) { return e.constructor.name + ": " + e.message; } }
const vals = { arr: JSON.parse("[1,2]"), str: JSON.parse('"ab"'), num: JSON.parse("5"), bool: JSON.parse("true"), obj: JSON.parse('{"a":1}'), nul: JSON.parse("null") };
const probe = JSON.parse('{"a":1}');
for (const k of Object.keys(vals)) {
  const v = vals[k];
  console.log(k, t(() => v.isPrototypeOf(probe)), t(() => v.propertyIsEnumerable("0")), t(() => v.propertyIsEnumerable("a")), t(() => v.hasOwnProperty("length")));
}
