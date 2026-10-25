// The pg driver's isWin shape: a module.exports accessor with a getter and a
// setter over one module-level variable. Reads and writes both go through the
// accessor, so the setter's transform is visible to the next read.
var seen = 0;
Object.defineProperty(module.exports, 'count', {
  get: function () { return seen; },
  set: function (v) { seen = v * 2; }
});
module.exports.count = 5;
console.log(module.exports.count);
module.exports.count = module.exports.count + 1;
console.log(module.exports.count, seen);
