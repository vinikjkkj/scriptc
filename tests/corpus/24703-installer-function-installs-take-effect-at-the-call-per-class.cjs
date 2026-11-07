// A program function that installs late methods on the prototype it is handed: before the call a method reaches the class chain's table member, after it the
// installed function, per class; two classes share the one function body.
class Commander { constructor() { this.tag = "base"; } }
["multi", "get"].forEach(function (name) {
  Commander.prototype[name] = function () { return "table-" + name + ":" + this.tag; };
});
function addTx(proto) {
  proto.pipeline = function (c) { return "pipeline:" + this.tag + ":" + (c === undefined ? "-" : c); };
  proto.exec2 = function () { return "exec2:" + this.tag; };
}
class Redis extends Commander { constructor() { super(); this.tag = "redis"; } }
class Cluster extends Commander { constructor() { super(); this.tag = "cluster"; } }
const early = new Redis();
let before;
try { before = early.pipeline("x"); } catch (e) { before = e.message; }
addTx(Redis.prototype);
addTx(Cluster.prototype);
console.log(before, early.pipeline("y"), new Cluster().pipeline(), new Cluster().exec2(), early.get());
