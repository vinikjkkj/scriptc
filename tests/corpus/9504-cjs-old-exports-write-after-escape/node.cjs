exports.count = 1;
exports.read = () => exports.count;
exports.bump = () => { exports.count = exports.count + 10; return exports.count; };
const api = require('./view.cjs')(exports);
module.exports = api;
