'use strict';
// ioredis' Commander: the base class starts `options` as an empty object literal and its methods read members off it;
// the subclass replaces it with the merged options.
class Holder {
  constructor() {
    this.options = {};
    this.reads = 0;
  }
  prefixed(key) {
    this.reads++;
    return (this.options.keyPrefix || '') + key;
  }
}

class Cluster extends Holder {
  constructor(options = {}) {
    super();
    this.options = { ...options, slotsRefreshInterval: 5000 };
    this.sharded = Boolean(this.options.shardedSubscribers);
  }
  describe() {
    return [this.prefixed('k'), this.options.slotsRefreshInterval, this.sharded, this.reads].join('|');
  }
}

exports.Holder = Holder;
exports.Cluster = Cluster;
