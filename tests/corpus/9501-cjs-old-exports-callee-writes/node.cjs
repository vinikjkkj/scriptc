exports.first = 1;
exports.kept = 'a';
const api = require('./sink.cjs')(exports);
module.exports = api;
