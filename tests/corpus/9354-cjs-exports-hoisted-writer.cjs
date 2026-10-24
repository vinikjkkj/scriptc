'use strict';
// A hoisted function attaches members to module.exports, and a top-level call runs it before any other top-level statement touches the exports object.
module.exports = {};
seedExports(3);
function seedExports(n) {
  module.exports.count = n;
  module.exports.label = function label() { return 'n=' + module.exports.count; };
  module.exports.enabled = n > 2;
}
console.log(module.exports.count, module.exports.enabled, module.exports.label());
module.exports.count = module.exports.count + 1;
console.log(module.exports.count, module.exports.label());
