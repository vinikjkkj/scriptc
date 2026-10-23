'use strict';
// pg's optional native client: pg-native is not installed, so requiring the
// client throws MODULE_NOT_FOUND from inside the client's own body, and the
// modules that re-export or wrap it throw the same error to their requirer.
const norm = (m) => m.split(__dirname).join('<D>');

let native = null;
try {
  native = require('./native.js');
} catch (err) {
  if (err.code !== 'MODULE_NOT_FOUND') throw err;
  console.log('native:', err.code);
  console.log(norm(err.message));
}
console.log(native);

// A relative file that does not exist.
try {
  require('./does-not-exist');
} catch (err) {
  console.log(err.code, norm(err.message));
  console.log(err instanceof Error, err.name);
}

// A package nothing installed resolves, required lazily from a function.
function loadOptional() {
  try {
    return require('definitely-not-installed-pkg');
  } catch (e) {
    return 'fallback:' + e.code;
  }
}
console.log(loadOptional());

// The getter shape from pg/lib/index.js: try the optional module, swallow
// only MODULE_NOT_FOUND, rethrow everything else.
const lib = {};
Object.defineProperty(lib, 'optional', {
  configurable: true,
  enumerable: false,
  get() {
    let v = null;
    try {
      v = require('./native.js');
    } catch (err) {
      if (err.code !== 'MODULE_NOT_FOUND') throw err;
    }
    return v;
  },
});
console.log(lib.optional === null);
console.log('done');
