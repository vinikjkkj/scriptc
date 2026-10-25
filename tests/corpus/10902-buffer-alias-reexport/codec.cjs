var B = require('buffer').Buffer
module.exports = {
  make: function (s) { return B.from(s) },
  size: function (n) { return B.alloc(n).length },
  check: function (x) { return B.isBuffer(x) },
  hex: function (x) { return x.toString('hex') }
}
