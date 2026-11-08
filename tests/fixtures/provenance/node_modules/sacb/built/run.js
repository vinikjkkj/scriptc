"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.run = void 0;
const index_1 = require("./index");
function run(log) {
    index_1.default(Promise.resolve(7), (err, val) => {
        log("ok " + err + " " + val);
    });
    index_1.default(Promise.resolve(8), () => {
        throw new Error("callback threw");
    });
}
exports.run = run;
