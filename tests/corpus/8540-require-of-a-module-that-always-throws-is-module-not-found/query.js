// Never loaded: client.js throws before it requires this module. It holds a
// construct the compiler has no lowering for, so it must not be compiled either.
const util = require('util');
function NativeQuery(config) {
  this.config = config;
}
util.inherits(NativeQuery, Object);
NativeQuery.prototype.handle = function () {
  return process.binding('nothing');
};
module.exports = NativeQuery;
