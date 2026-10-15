'use strict';
class Base {
  static tag = 'base'; //                 a DECLARED static FIELD
  constructor() { this.n = 0; }
  static statementKey(o) { return 'k' + o; }
  static other(o) { return 'o' + o; }
}
module.exports = Base;
