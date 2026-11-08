"use strict";
function slotOf(k) { let h = 0; for (let i = 0; i < k.length; i++) h = (h * 31 + k.charCodeAt(i)) & 0x3fff; return h; }
var generate = module.exports = function generate(str) {
  return slotOf(String(str));
};
module.exports.generateMulti = function generateMulti(keys) {
  var i = 1;
  var len = keys.length;
  var base = generate(keys[0]);
  while (i < len) {
    if (generate(keys[i++]) !== base) return -1;
  }
  return base;
};
