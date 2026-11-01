'use strict';
// A forEach over a literal array of builtin constructors exports one member per constructor (webidl-conversions
// shape). The callback captures its per-element name and article only.
function makeException(ErrorType, message, options) {
  return new ErrorType(`${options.context ? options.context : "Value"} ${message}.`);
}

[
  Int8Array,
  Uint8Array,
  Float64Array
].forEach(func => {
  const { name } = func;
  const article = /^[AEIOU]/u.test(name) ? "an" : "a";
  exports[name] = (value, options = {}) => {
    if (!ArrayBuffer.isView(value)) {
      throw makeException(TypeError, `is not ${article} ${name} object`, options);
    }
    return name + ":" + article;
  };
});

exports["unsigned long long"] = (value, options = {}) => value;
exports.DOMTimeStamp = exports["unsigned long long"];
