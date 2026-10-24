// pgpass's helper.js: `var parseLine = module.exports.parseLine = function ...`
// below a function that reads parseLine. The binding holds undefined until its
// declaration runs (Node's var window) and the exported function afterwards.
'use strict';
module.exports.getPassword = function (line) {
  function onLine(l) {
    var entry = parseLine(l);
    return entry;
  }
  return onLine(line);
};
try {
  module.exports.getPassword('early');
  console.log('unreachable');
} catch (e) {
  console.log('early call:', e instanceof TypeError, e.message);
}
var parseLine = module.exports.parseLine = function (line) {
  return line.split(':');
};
console.log(module.exports.getPassword('a:b:c'), module.exports.parseLine('d:e'));
console.log(typeof parseLine, parseLine === module.exports.parseLine);
