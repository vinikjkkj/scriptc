"use strict";
var count = 0;
var hit = module.exports = function hit(tag) {
  count++;
  return tag + ":" + count;
};
module.exports.twice = function twice(s) { return hit(s) + "|" + hit(s); };
module.exports.arrow = (a, b) => a * b + count;
module.exports.label = "ck";
module.exports.twice2 = function (s) { return "v1" + s; };
module.exports.twice2 = function (s) { return "v2" + s; };
