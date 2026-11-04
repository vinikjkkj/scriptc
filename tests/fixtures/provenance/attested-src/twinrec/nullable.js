'use strict';
// ioredis' Cluster: a helper object that is created by one method and used by others, the use guarded by an option
// rather than by the field itself, so the field's type is "the class or undefined" at every call.
class Group {
  constructor(label) {
    this.label = label;
    this.started = 0;
  }
  start() {
    this.started++;
    return Promise.resolve([this.label, this.started]);
  }
  stop() {
    this.started = 0;
  }
  count(channels) {
    return channels.length + this.started;
  }
}

class Cluster {
  constructor(options) {
    this.options = options;
    if (options.sharded) this.create();
  }
  create() {
    this.group = new Group('g');
  }
  go() {
    if (this.options.sharded) {
      return this.group.start();
    }
    return Promise.resolve([]);
  }
  halt() {
    if (this.options.sharded) this.group.stop();
    return this.options.sharded ? this.group.count(['a', 'b']) : -1;
  }
  breakIt() {
    return this.group.count([]);
  }
}
exports.Cluster = Cluster;
