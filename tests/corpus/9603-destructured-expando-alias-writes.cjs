// A destructured alias of a factory-made function's expando object (the shape debug uses):
// writes through the alias reach the object.
function setup(env) {
  function createDebug(ns) { return { ns, enabled: ns.length > 2 }; }
  createDebug.formatters = {};
  return createDebug;
}
const createDebug = setup({});
const { formatters } = createDebug;
formatters.o = function (v) { return 'obj:' + v; };
formatters.O = function (v) { return 'OBJ:' + v; };
console.log(formatters.o(1), formatters.O(2), createDebug('abc').enabled);
