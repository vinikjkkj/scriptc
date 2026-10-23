// pg-types registers its text parsers by passing library functions as values
// (register(700, parseFloat)) from an authored-JavaScript module, and parses with
// parseFloat over an untyped (checked-dynamic) argument. The function values are
// the interned closures a TypeScript program already gets; the dynamic argument
// goes through ToString first, then the decimal-prefix parse.
'use strict';
var text = {};
function init(register) {
  register(700, parseFloat);
  register(701, parseFloat);
  register(23, parseInteger);
}
function parseInteger(value) {
  return parseInt(value, 10);
}
init(function (oid, converter) {
  text[oid] = converter;
});
console.log(text[700]('1.5'), text[701]('2.5x'), text[23]('42'), text[700] === text[701]);

function pf(x) {
  return parseFloat(x);
}
console.log(pf('1.5abc'), pf('  -2e3x'), pf('abc'), pf(''), pf('.5'), pf('0x10'), pf('Infinityx'));
console.log(pf(7), pf(7.25), pf(true), pf(null), pf(undefined), pf([1.5, 2]));
console.log(pf({ toString() { return '9.5z'; } }), pf({ valueOf() { return 3; }, toString() { return '4.5'; } }));
var g = function (entry) {
  if (entry !== null) {
    entry = parseFloat(entry);
  }
  return entry;
};
console.log(g('3.25'), g(null), g('x'));
