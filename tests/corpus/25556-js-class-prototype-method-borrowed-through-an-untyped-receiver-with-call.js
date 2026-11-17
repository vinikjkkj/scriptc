// A JavaScript class prototype method is borrowed with call/apply on a receiver whose class the compiler cannot see (a parameter), the way ioredis' Cluster borrows Redis.prototype.silentEmit.
class Redis {
  constructor() { this.label = "redis"; }
  silentEmit(event, payload) { return this.label + ":" + event + ":" + payload; }
  tag(n) { return this.label + "#" + n; }
}
class Pooled extends Redis { constructor() { super(); this.label = "pooled"; } }
function emitOn(self, err) { return Redis.prototype.silentEmit.call(self, "error", err); }
function tagOn(self) { return [Redis.prototype.tag.call(self, 1), Redis.prototype.tag.apply(self, [2])].join(" "); }
console.log(emitOn(new Redis(), "boom"), emitOn(new Pooled(), "bang"));
console.log(tagOn(new Redis()), tagOn(new Pooled()));
