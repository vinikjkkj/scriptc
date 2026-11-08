"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.helper = exports.Redis = exports.default = void 0;
exports = module.exports = require("./Redis").default;
var Redis_1 = require("./Redis");
Object.defineProperty(exports, "default", { enumerable: true, get: function () { return Redis_1.default; } });
var Redis_2 = require("./Redis");
Object.defineProperty(exports, "Redis", { enumerable: true, get: function () { return Redis_2.default; } });
function helper(x) {
    return x + 1;
}
exports.helper = helper;
