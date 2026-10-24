'use strict';
// A top-level block (not a function body) attaches a chained pair of members: `module.exports.a = module.exports.b = function`. The else arm of an if statement runs only when its condition is false.
module.exports = {};
let streamModule = JSON.parse('null');
if (streamModule && streamModule.Transform) {
  module.exports.encodeStream = function (encoding) { return 'live:' + encoding; };
} else {
  module.exports.encodeStream = module.exports.decodeStream = function () { return 'fallback'; };
}
console.log(module.exports.encodeStream('a'), module.exports.decodeStream(), module.exports.decodeStream === module.exports.encodeStream);
