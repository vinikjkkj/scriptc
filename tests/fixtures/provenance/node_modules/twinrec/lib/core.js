'use strict';
const ResultSetHeader = require('./header.js');
// The callback-style core the promise classes wrap (mysql2's lib/base/*).
class Core {
  constructor(label) {
    this.label = label;
    this.closed = false;
  }
  run(sql, params, cb) {
    if (sql === 'boom' || sql === 'q:boom') {
      cb(new Error('boom from ' + this.label));
      return;
    }
    if (sql.startsWith('INSERT')) {
      cb(null, [new ResultSetHeader(1, 42), []]);
      return;
    }
    cb(null, [sql + ':' + (params ? params.length : 0), [this.label]]);
  }
  end(cb) {
    this.closed = true;
    cb(null);
  }
}
module.exports = Core;
