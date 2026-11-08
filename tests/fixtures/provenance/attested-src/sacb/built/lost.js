"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.lost = void 0;
const utils_1 = require("./utils");
function lost(log) {
    const ret = utils_1.tryCatch(() => {
        throw new Error("boom");
    })(new Error("x"));
    if (ret !== undefined) {
        log(ret.e.message + " " + (ret.e instanceof Error));
    }
}
exports.lost = lost;
