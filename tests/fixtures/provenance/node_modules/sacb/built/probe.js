"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.probe = void 0;
const utils_1 = require("./utils");
function probe(log) {
    const ret = utils_1.tryCatch(() => {
        throw new Error("boom");
    })(new Error("x"));
    log(String(ret === utils_1.errorObj));
    if (ret !== undefined) {
        log(ret.e.message + " " + (ret.e instanceof Error));
    }
    log(String(utils_1.errorObj.e instanceof Error));
    if (ret !== undefined) {
        ret.e = new TypeError("later");
    }
    log(String(utils_1.errorObj.e instanceof TypeError));
}
exports.probe = probe;
