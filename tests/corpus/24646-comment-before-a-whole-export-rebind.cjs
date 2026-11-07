// whole export spelled `exports = module.exports = Redis` here: a comment that mentions `module.exports = x` must not change how the statement below is read.
// module.exports = x
class Redis { constructor() { this.x = 1; } static tag() { return "t"; } }
exports = module.exports = Redis;
exports.default = Redis;
console.log(new Redis().x, Redis.tag());
