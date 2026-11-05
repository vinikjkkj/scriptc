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
