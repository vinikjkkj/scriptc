exports.init = init;
exports.log = log;
exports.colors = [6, 2, 3];
exports.inspectOpts = { hideDate: false, colors: true };
if (process.argv.length > 99) {
  exports.colors = [9, 9];
}
const api = require('./common.cjs')(exports);
module.exports = api;
function init(d) { d.inited = true; }
function log(...args) { return args.length + exports.colors.length; }
