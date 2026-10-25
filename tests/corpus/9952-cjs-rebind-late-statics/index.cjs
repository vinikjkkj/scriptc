"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Redis = exports.default = void 0;
exports = module.exports = require("./redis.cjs").default;
exports.print = print;
exports.version = 7;
exports.label = "clsstatics";
exports.table = { a: 1, b: [2, 3] };
exports.double = function (n) {
    return n * 2;
};
function print(err, reply) {
    console.log("Reply: " + reply + " " + err);
}
