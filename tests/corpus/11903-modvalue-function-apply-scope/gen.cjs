'use strict';
// generate-function's toFunction exactly: the scope's keys (a run-time list)
// and values become the parameters and arguments of a Function built with
// Function.apply(null, keys.concat(src)), then .apply(null, vals).
function generator() {
  const parts = [];
  return {
    add(text) {
      parts.push(text);
    },
    toFunction(scope) {
      const src = 'return (' + parts.join('\n') + ')';
      const keys = Object.keys(scope).map(function (key) {
        return key;
      });
      const vals = keys.map(function (key) {
        return scope[key];
      });
      return Function.apply(null, keys.concat(src)).apply(null, vals);
    },
  };
}

module.exports = generator;
