'use strict';
exports.marker = 0;
class A { constructor() { this.n = 'A'; } }
class B { constructor() { this.n = 'B'; } }
const ctorMap = { A, B };
Object.entries(ctorMap).forEach(([name, ctor]) => {
  module.exports[name] = ctor;
});
