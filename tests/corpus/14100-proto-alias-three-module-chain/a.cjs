'use strict';
// A: the method lives here, untyped (implicit-any JS). B and C only inherit it.
class A {
  constructor(cfg) {
    this.config = cfg;
    this.tag = "a";
  }
  y(callback) {
    if (this.config.closed) return "closed";
    return "y:" + this.config.n + ":" + (callback === undefined ? "nocb" : "cb");
  }
}
module.exports = A;
