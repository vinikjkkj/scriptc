"use strict";
// ioredis's cluster constructor: `const redisOptions = { ...(this.options.redisOptions ?? {}) }; delete redisOptions.himportFieldsets;`.
// The options object is held checked-dynamically, so the copy keeps every own key it holds, the delete removes one of them, and `in` and
// Object.keys answer for the copy exactly.
class Holder {
  constructor(o) {
    this.options = JSON.parse(JSON.stringify(o ?? {}));
  }
  describe() {
    const redisOptions = { ...(this.options.redisOptions ?? {}) };
    const removed = delete redisOptions.extra;
    redisOptions.seen = true;
    return JSON.stringify({ removed, keys: Object.keys(redisOptions), hasExtra: "extra" in redisOptions, extra: redisOptions.extra === undefined, prefix: redisOptions.keyPrefix, hidden: redisOptions.zzz });
  }
}
console.log(new Holder({ redisOptions: { keyPrefix: "p:", extra: ["x"], tag: "t", zzz: 1 } }).describe());
console.log(new Holder().describe());
console.log(new Holder({ redisOptions: null }).describe());
