// ioredis ConnectionPool shape: an optional call on a function-valued member
// of a field whose value is an options bag defaulted to {}.
class Pool {
  constructor(redisOptions, hooks = {}) {
    this.redisOptions = redisOptions;
    this.hooks = hooks;
    this.nodes = {};
  }
  make(key, ro) {
    const r = { key: key, ro: ro };
    this.hooks.onCreate?.(r, ro);
    this.nodes[key] = r;
    return r;
  }
  flip(key) {
    this.hooks.onRoleChange?.(this.nodes[key], key, true);
  }
  remove(key) {
    if (this.nodes[key]) {
      this.hooks.onRemove?.(this.nodes[key]);
      delete this.nodes[key];
    }
  }
}
const log = [];
const p = new Pool(1, {
  onCreate: (r, ro) => log.push("create " + r.key + " " + ro),
  onRemove: (r) => log.push("remove " + r.key),
});
p.make("a", false);
p.make("b", true);
p.flip("a");
p.remove("a");
p.remove("zz");
console.log(log.join("|"));
const q = new Pool(2);
q.make("x", false);
q.flip("x");
q.remove("x");
console.log("q", Object.keys(q.nodes).length, Object.keys(q.hooks).length);
