// A function-valued module that also carries function members (mysql2's plugin shape).
function factory(x) { return x + 1; }
function calc(x) { return x * 3; }
function twice(x) { return x * 2; }
module.exports = factory;
module.exports.calc = calc;
module.exports.twice = twice;
