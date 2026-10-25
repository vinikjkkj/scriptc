// The same accessor through the bare `exports` spelling, with a boolean
// state flag read by a sibling function export.
var isWin = false;
Object.defineProperty(exports, 'isWin', {
  get: function () { return isWin; },
  set: function (val) { isWin = val; }
});
exports.describe = function () { return 'isWin=' + isWin; };
console.log(exports.isWin, exports.describe());
exports.isWin = true;
console.log(exports.isWin, exports.describe());
exports.isWin = false;
console.log(exports.isWin);
