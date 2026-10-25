// Two accessors and a plain value export share one module: each accessor
// keeps its own state, and the plain export is untouched by the writes.
var a = 1;
var b = 'x';
Object.defineProperty(module.exports, 'a', {
  get: function () { return a; },
  set: function (v) { a = v + 100; }
});
Object.defineProperty(module.exports, 'b', {
  get: function () { return b + b; },
  set: function (v) { b = v; }
});
module.exports.plain = 42;
module.exports.a = 7;
module.exports.b = 'yz';
console.log(module.exports.a, module.exports.b, module.exports.plain);
