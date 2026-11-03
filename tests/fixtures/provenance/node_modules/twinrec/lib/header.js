'use strict';
// A packet class, like mysql2's ResultSetHeader: statements that write answer an instance of it.
class ResultSetHeader {
  constructor(affectedRows, insertId) {
    this.affectedRows = affectedRows;
    this.insertId = insertId;
  }
}
module.exports = ResultSetHeader;
