// A JS constructor whose prototype is replaced by Object.create(base, { constructor }):
// its function type has implicit-any parameters and an inferred any return. The
// any-parameter / any-return function-type mappings need a SPELLED annotation, so
// these stay the shapes the JS lane already compiles, and `.constructor === C`
// compares the function with itself instead of reaching the dynamic engine.
var BASE = {};
function make(name) {
  function Custom(message) {
    this.m = message;
  }
  Custom.prototype = Object.create(BASE, {
    constructor: { value: Custom, writable: true, enumerable: false, configurable: true },
  });
  return Custom;
}
var C = make('C');
var o = new C('x');
console.log('ctor identity:', C.prototype.constructor === C, o.m);
var wrap = function (fn) {
  return function (e) {
    return fn(e);
  };
};
console.log(wrap(function (v) { return v + 1; })(41));
