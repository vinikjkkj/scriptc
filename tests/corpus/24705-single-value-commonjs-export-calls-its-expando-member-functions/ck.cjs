"use strict";
// cluster-key-slot's shape: the module IS a function and carries more functions as members.
module.exports = generate;
module.exports.generateMulti = generateMulti;
module.exports.describe = describe;
function slotOf(k) { let h = 0; for (let i = 0; i < k.length; i++) h = (h * 31 + k.charCodeAt(i)) & 0x3fff; return h; }
function generate(key) { return slotOf(String(key)); }
function generateMulti(keys) {
  let prev = -1;
  for (let i = 0; i < keys.length; i++) {
    const s = generate(keys[i]);
    if (prev === -1) prev = s; else if (prev !== s) return -1;
  }
  return prev;
}
function describe(x, tag) { return tag + ":" + x.n; }
