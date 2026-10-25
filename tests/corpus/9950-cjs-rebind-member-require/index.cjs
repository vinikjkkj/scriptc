"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports = module.exports = require("./redis.cjs").default;
exports.print = print;
exports.version = 7;
function print(err, reply) {
    console.log("Reply: " + reply + " " + err);
}
