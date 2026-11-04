'use strict';
// ioredis' Cluster shape: a derived class re-declares the base class's `options` with a wider record, and its
// constructor re-assigns it from lodash-style defaults(), whose declared result is an INTERSECTION of the sources.
const utils_1 = require('./opts-defaults');
const DEFAULTS = { slotsRefreshInterval: 5000, scaleReads: 'master', shardedSubscribers: false };

const { Base } = require('./opts-base');

class Derived extends Base {
  constructor(options = {}) {
    super();
    this.options = (0, utils_1.defaults)({}, options, DEFAULTS, this.options);
    if (this.options.shardedSubscribers) {
      this.log.push('sharded');
    }
    if (this.options.redisOptions && this.options.redisOptions.keyPrefix && !this.options.keyPrefix) {
      this.options.keyPrefix = this.options.redisOptions.keyPrefix;
    }
    if (typeof this.options.scaleReads !== 'function' && ['all', 'master', 'slave'].indexOf(this.options.scaleReads) === -1) {
      throw new Error('Invalid option scaleReads "' + this.options.scaleReads + '"');
    }
    this.options.slotsRefreshInterval = this.options.slotsRefreshInterval * 2;
  }
  describe() {
    const o = this.options;
    return [o.keyPrefix, o.scaleReads, o.slotsRefreshInterval, o.shardedSubscribers, this.log.join('+')].join('|');
  }
}

// The assignment is conditional: when it does not run, `options` is the base's own plain object, and the reads and
// the write below name members that object never had.
class Late extends Base {
  constructor(flag) {
    super();
    if (flag) {
      this.options = (0, utils_1.defaults)({}, {}, DEFAULTS, this.options);
    }
    this.seen = [this.options.shardedSubscribers, this.options.slotsRefreshInterval];
    this.options.slotsRefreshInterval = 99;
    this.after = this.options.slotsRefreshInterval;
  }
  describe() {
    return [this.seen.join(','), this.after, this.options.keyPrefix].join('|');
  }
}

exports.Derived = Derived;
exports.Late = Late;
