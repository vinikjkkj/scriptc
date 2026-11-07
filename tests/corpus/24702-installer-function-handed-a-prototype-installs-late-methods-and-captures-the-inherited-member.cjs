// ioredis transaction.js: one program function installs late methods on whatever prototype it is handed (`addTransactionSupport(Redis.prototype)`),
// captures the member the chain gave before the install (`const { multi } = redis`) and calls it back from the replacement; two sibling classes share the one body.
class Commander { constructor() { this.tag = "base"; } }
["multi", "get"].forEach(function (name) {
  Commander.prototype[name] = function (a) { return "table-" + name + ":" + this.tag + ":" + (a === undefined ? "-" : a); };
});
function addTx(proto) {
  proto.pipeline = function (c) { return "pipeline:" + this.tag + ":" + (c === undefined ? "-" : c); };
  const { multi } = proto;
  proto.multi = function (a) {
    if (a === "plain") return multi.call(this);
    return "multi:" + this.tag + ":" + (a === undefined ? "-" : a);
  };
}
class Redis extends Commander { constructor() { super(); this.tag = "redis"; } }
class Cluster extends Commander { constructor() { super(); this.tag = "cluster"; } }
addTx(Redis.prototype);
addTx(Cluster.prototype);
const r = new Redis();
const c = new Cluster();
console.log(r.pipeline(), r.multi(), r.multi("plain"), c.pipeline("x"), c.multi("y"), c.multi("plain"), r.get(), c.get());
