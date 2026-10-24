// iconv-lite's merge-exports helper: Object.hasOwn probed, bound once, called with untyped operands.
"use strict"
var hasOwn = typeof Object.hasOwn === "undefined" ? Function.call.bind(Object.prototype.hasOwnProperty) : Object.hasOwn

function mergeModules (target, module) {
  for (var key in module) {
    if (hasOwn(module, key)) {
      target[key] = module[key]
    }
  }
}
const target = { z: 0 };
class A { constructor() { this.x = 1; } m() { return 2; } }
mergeModules(target, { a: 1, b: 'x' });
mergeModules(target, new A());
console.log(target, hasOwn(target, 'a'), hasOwn(target, 'nope'), hasOwn([1], 0), hasOwn('s', 'length'));
