'use strict';
// A mysql2-shaped promise wrapper: the declaration file names the class `Pool`
// and gives it a generic, overloaded `execute` through a mixin; the code
// builds it as `PromisePool` over a callback-style core.
class Core {
  constructor(label) {
    this.label = label;
  }
  run(sql, params, cb) {
    if (sql === 'boom') {
      cb(new Error('boom from ' + this.label));
      return;
    }
    cb(null, [sql + ':' + (params ? params.length : 0), this.label]);
  }
}
class PromisePool {
  constructor(core) {
    this.core = core;
    this.calls = 0;
  }
  execute(sql, params) {
    this.calls++;
    return new Promise((resolve, reject) => {
      this.core.run(sql, params, (err, r) => (err ? reject(err) : resolve([r[0], [r[1]]])));
    });
  }
  count() {
    return this.calls;
  }
}
function createPool(label) {
  return new PromisePool(new Core(label));
}
exports.createPool = createPool;
exports.PromisePool = PromisePool;
