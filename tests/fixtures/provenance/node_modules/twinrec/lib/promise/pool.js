'use strict';
const EventEmitter = require('events').EventEmitter;
const PromisePoolConnection = require('./pool_connection.js');
const Core = require('../core.js');

class PromisePool extends EventEmitter {
  constructor(core, thePromise) {
    super();
    this.core = core;
    this.Promise = thePromise || Promise;
    this.calls = 0;
  }
  getConnection() {
    const core = this.core;
    return new this.Promise((resolve) => {
      resolve(new PromisePoolConnection(new Core(core.label + '-c'), this.Promise));
    });
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
    if (typeof args === 'function') {
      throw new Error('Callback function is not available with promise clients.');
    }
    return new this.Promise((resolve, reject) => {
      core.run(sql, args, (err, r) => (err ? reject(err) : resolve(r)));
    });
  }
  end() {
    const core = this.core;
    return new this.Promise((resolve, reject) => {
      core.end((err) => (err ? reject(err) : resolve()));
    });
  }
  count() {
    return this.calls;
  }
}
module.exports = PromisePool;
