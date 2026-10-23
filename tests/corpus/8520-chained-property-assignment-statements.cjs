'use strict';

const log = [];

var matcher = module.exports.match = function (a, b) {
  return a + b;
};
var parse = module.exports.parse = function (line) {
  log.push('parse:' + line);
  return line.length;
};
let holder = { slot: 0, other: 0 };
let seen = 0;
seen = holder.slot = 7;
holder.other = holder.slot = 9;

const cfg = { n: 1 };
const alias = cfg.n = 5 + cfg.n;

console.log(matcher(2, 3), module.exports.match(4, 5), matcher === module.exports.match);
console.log(parse('abc'), module.exports.parse('de'), log.join(','));
console.log(seen, holder.slot, holder.other, alias, cfg.n);
console.log(typeof module.exports.match);
