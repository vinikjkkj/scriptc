'use strict';
// Shape of the generate-function package's use in mysql2: a builder collects
// text lines; toFunction(scope) turns the collected text into a function whose
// parameters are the scope's names and whose arguments are the scope's values.
function generator() {
  const parts = [];
  return {
    add(text) {
      parts.push(text);
    },
    toFunction(scope) {
      const src = 'return (' + parts.join('\n') + ')';
      return new Function('wrap', 'wrapNull', 'LocalDate', src)(scope.wrap, scope.wrapNull, scope.LocalDate);
    },
  };
}

module.exports = generator;
