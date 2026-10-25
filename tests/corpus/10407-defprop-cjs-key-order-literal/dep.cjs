// A whole replacement with an object literal: its own literal order, then
// later writes append in write order.
module.exports = { gamma: 'g', delta: 'd' };
module.exports.beta = 'b';
module.exports.alpha = 'a';
