exports.pre = function pre() {
  return [typeof exports.later, exports.later === undefined, String(exports.later)];
};
const early = [];
try {
  exports.later();
} catch (e) {
  early.push(e instanceof TypeError ? "TypeError" : "other", e.message);
}
early.push(...exports.pre());
exports.early = early;
exports.later = function later() {
  return 'later';
};
exports.after = function after() {
  return [exports.later(), typeof exports.later];
};
const api = require('./view.cjs')(exports);
module.exports = api;
