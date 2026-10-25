// The getter is read from inside a function body that runs after the module
// has set the state, and a setter write comes from a function as well.
var level = 1;
Object.defineProperty(module.exports, 'level', {
  get: function () { return level; },
  set: function (v) { level = v > 10 ? 10 : v; }
});
function raise(by) { module.exports.level = module.exports.level + by; return module.exports.level; }
console.log(raise(3));
console.log(raise(20));
console.log(module.exports.level);
