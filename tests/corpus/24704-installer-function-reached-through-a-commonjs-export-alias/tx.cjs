"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.addTransactionSupport = void 0;
function addTransactionSupport(redis) {
  redis.pipeline = function (commands) { return "pipeline:" + this.tag + ":" + (commands === undefined ? "-" : commands); };
  const { multi } = redis;
  redis.multi = function (a) {
    if (a === "plain") return multi.call(this);
    return "multi:" + this.tag + ":" + (a === undefined ? "-" : a);
  };
  const { exec } = redis;
  redis.exec = function (cb) { return "wrapped[" + exec.call(this) + "]" + (cb === undefined ? "" : cb); };
}
exports.addTransactionSupport = addTransactionSupport;
