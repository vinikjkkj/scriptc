'use strict';
// B: extends A through require and declares nothing of its own.
const A = require('./a.cjs');
class B extends A {
  constructor(cfg) {
    super(cfg);
    this.tag = "b";
  }
}
module.exports = B;
