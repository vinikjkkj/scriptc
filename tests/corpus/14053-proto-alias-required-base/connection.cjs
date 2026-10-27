'use strict';
const Base = require('./base.cjs');
class Connection extends Base {
  constructor(cfg) {
    super(cfg);
    this.tag = "conn";
  }
}
module.exports = Connection;
