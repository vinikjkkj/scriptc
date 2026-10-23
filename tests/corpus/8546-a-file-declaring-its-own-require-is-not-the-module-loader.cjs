// A file that declares its own `require` is not asking the CommonJS loader:
// the MODULE_NOT_FOUND rule must leave every statement of it alone.
function require(x) { return 'local:' + x; }
var a = require('no-such-pkg-xyz');
console.log(a);
try { var b = require('./missing-file'); } catch (e) { throw e; }
console.log(b);
console.log('end');
