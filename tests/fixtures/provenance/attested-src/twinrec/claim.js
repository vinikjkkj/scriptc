"use strict";
// Untyped JavaScript: every function returns a promise the declaration file claims is a Promise<number>.
exports.fulfilled = (v) => new Promise((resolve) => resolve(v));
exports.rejected = (m) => new Promise((_, reject) => reject(new Error(m)));
exports.settled = (v) => Promise.resolve(v);
exports.timer = (v) => new Promise((resolve) => setTimeout(() => resolve(v), 5));
exports.again = async (p) => (await p) + 0;
exports.wrong = () => new Promise((resolve) => resolve(JSON.parse('"not a number"')));
// One pending source with reactions registered around the claim: JavaScript's promise is the claim, so these run in
// registration order.
let held = null;
let settleHeld = null;
exports.pend = (log) => {
  held = new Promise((resolve) => {
    settleHeld = resolve;
  });
  held.then(() => log("src-then-1"));
  return held;
};
exports.watchAwait = (log) => {
  (async () => {
    await held;
    log("src-await");
  })();
};
exports.watchThen = (log) => {
  held.then(() => log("src-then-2"));
};
exports.release = (v) => settleHeld(v);
// A local that holds the claimed promise before it is returned (ioredis' Cluster#quit shape).
const cbdep_1 = require("./cbdep");
exports.quitLike = function quitLike(wait, callback) {
  if (wait) {
    const ret = (0, cbdep_1.default)(Promise.resolve("OK"), callback);
    setImmediate(() => callback && callback(null, "closed"));
    return ret;
  }
  return (0, cbdep_1.default)(new Promise((resolve) => setTimeout(() => resolve("late"), 1)), callback);
};
// A claimed promise whose payload is an array of [error, result] tuples (ioredis' Pipeline#exec shape).
exports.execLike = function execLike(fail, callback) {
  return (0, cbdep_1.default)(new Promise((resolve) => setTimeout(() => resolve([[fail ? new Error("bad") : null, fail ? undefined : "OK"], [null, 7]]), 1)), callback);
};
