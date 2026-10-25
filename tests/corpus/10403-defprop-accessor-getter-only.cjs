// A getter-only accessor on module.exports, read through a sibling function
// that changes the state the getter returns.
var ticks = 0;
Object.defineProperty(module.exports, 'ticks', {
  enumerable: true,
  get: function () { return ticks; }
});
function tick() { ticks = ticks + 1; return ticks; }
console.log(module.exports.ticks);
tick();
tick();
console.log(module.exports.ticks, tick());
