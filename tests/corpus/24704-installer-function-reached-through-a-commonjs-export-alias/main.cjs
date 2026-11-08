"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const transaction_1 = require("./tx.cjs");
class Commander { constructor() { this.tag = "base"; } }
["multi", "get", "exec"].forEach(function (name) {
  Commander.prototype[name] = function (a) { return "table-" + name + ":" + this.tag; };
});
class Redis extends Commander { constructor() { super(); this.tag = "redis"; } }
class Cluster extends Commander { constructor() { super(); this.tag = "cluster"; } }
(0, transaction_1.addTransactionSupport)(Redis.prototype);
(0, transaction_1.addTransactionSupport)(Cluster.prototype);
const r = new Redis();
const c = new Cluster();
console.log(r.pipeline(), r.multi(), r.multi("plain"), c.pipeline("x"), c.multi("y"), c.exec("e"), r.get());
