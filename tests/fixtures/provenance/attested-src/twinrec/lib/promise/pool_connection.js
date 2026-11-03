'use strict';
const EventEmitter = require('events').EventEmitter;

class PromisePoolConnection extends EventEmitter {
  constructor(core, thePromise) {
    super();
    this.core = core;
    this.Promise = thePromise || Promise;
    this.calls = 0;
  }
  query(sql, args) {
    const core = this.core;
    return new this.Promise((resolve, reject) => {
      core.run('q:' + sql, args, (err, r) => (err ? reject(err) : resolve(r)));
    });
  }
  execute(sql, args) {
    const core = this.core;
    this.calls++;
    return new this.Promise((resolve, reject) => {
      core.run(sql, args, (err, r) => (err ? reject(err) : resolve(r)));
    });
  }
  release() {
    this.emit('release', this.calls);
  }
}
module.exports = PromisePoolConnection;
