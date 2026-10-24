'use strict';
// Exported functions with defaulted and optional parameters, one parameter of each kind untyped (mysql2's
// helpers.fieldEscape is `(field, isEval = true) => ...`).
const privateProps = new Set(['__proto__']);
const fieldEscape = (field, isEval = true) => {
  if (privateProps.has(field)) throw new Error('private ' + field);
  return isEval ? JSON.stringify(field) : field;
};
exports.fieldEscape = fieldEscape;
function pad(text, width = 4, fill = '.') {
  var out = String(text);
  while (out.length < width) out = fill + out;
  return out;
}
exports.pad = pad;
exports.scale = function (v, by = 2) { return v * by; };
