'use strict';
// The inherited method lives on a class two modules away (mysql2's BaseConnection).
class Base {
  constructor(cfg) {
    this.config = cfg;
  }
  end(callback) {
    if (this.config.isServer) {
      return "server";
    }
    return "end:" + this.config.n + ":" + (callback === undefined ? "nocb" : "cb");
  }
}
module.exports = Base;
