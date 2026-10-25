"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports = module.exports = require("./redis.cjs").default;
var Redis_1 = require("./redis.cjs");
Object.defineProperty(exports, "default", { enumerable: true, get: function () { return Redis_1.default; } });
Object.defineProperty(exports, "Redis", { enumerable: true, get: function () { return Redis_1.default; } });
exports.print = print;
function print(err, reply) {
    console.log("Reply: " + reply + " " + err);
}
