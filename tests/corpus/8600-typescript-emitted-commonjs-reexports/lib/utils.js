"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.zipPairs = exports.isArguments = exports.defaults = exports.noop = void 0;
const lodash_1 = require("./lodash");
Object.defineProperty(exports, "defaults", { enumerable: true, get: function () { return lodash_1.defaults; } });
Object.defineProperty(exports, "isArguments", { enumerable: true, get: function () { return lodash_1.isArguments; } });
Object.defineProperty(exports, "noop", { enumerable: true, get: function () { return lodash_1.noop; } });
function zipPairs(keys, values) {
    return keys.map((key, index) => key + "=" + values[index]);
}
exports.zipPairs = zipPairs;
