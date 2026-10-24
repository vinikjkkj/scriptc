'use strict';
function Long(low, high, unsigned) {
  this.low = low | 0;
  this.high = high | 0;
  this.unsigned = !!unsigned;
}
Long.prototype.toString = function () {
  return 'L(' + this.low + ',' + this.high + ')';
};
module.exports = Long;
