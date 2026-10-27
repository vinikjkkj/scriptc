var alias = module.exports;
alias.x = 1;
module.exports.y = 2;
function bump() { alias.x = 10; }
bump();
exports.z = alias === module.exports;
