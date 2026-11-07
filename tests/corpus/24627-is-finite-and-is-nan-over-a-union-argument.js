// The global isFinite / isNaN over a UNION-typed argument (a JSDoc {String|Number} parameter, ms's `type === "number" && isFinite(val)` guard):
// ToNumber first, then the test, as for a checked-dynamic argument.
/**
 * @param {String|Number} val
 * @return {String|Number}
 */
var fnm = function (val, options) {
  var type = typeof val;
  if (type === 'string' && val.length > 0) {
    return "str:" + val;
  } else if (type === 'number' && isFinite(val)) {
    return "fin:" + val;
  }
  throw new Error('bad val=' + JSON.stringify(val));
};
function g(x) { return isFinite(x) + "/" + isNaN(x); }
/** @param {String|Number|Boolean} v */
function h(v) { return isFinite(v) + "/" + isNaN(v); }
console.log(fnm("a"), fnm(5));
try { fnm(Infinity); } catch (e) { console.log(e.message); }
console.log(g("12"), g("a"), g(null), g(undefined), g(1 / 0), g(true), g(JSON.parse("7")));
console.log(h("12"), h("a"), h(3), h(false), h(NaN));
