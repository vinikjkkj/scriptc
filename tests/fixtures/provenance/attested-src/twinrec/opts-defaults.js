'use strict';
function defaults(target, ...sources) {
  const out = { ...target };
  for (const source of sources) {
    if (source == null) continue;
    for (const key of Object.keys(source)) {
      if (out[key] === undefined) out[key] = source[key];
    }
  }
  return out;
}
exports.defaults = defaults;
