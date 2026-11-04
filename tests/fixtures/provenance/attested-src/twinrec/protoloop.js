'use strict';
// ioredis' Commander: the command methods are installed on the prototype in a loop over a list, so no method is
// declared in the class body; the declaration file names them.
class Commander {
  constructor() {
    this.n = 0;
  }
}
const COMMANDS = ['get', 'set', 'quit'];
COMMANDS.forEach((name) => {
  Commander.prototype[name] = function (...args) {
    this.n++;
    return name + ':' + args.join(',') + ':' + this.n;
  };
});
class Redis extends Commander {
  constructor() {
    super();
    this.label = 'r';
  }
}
exports.Redis = Redis;
