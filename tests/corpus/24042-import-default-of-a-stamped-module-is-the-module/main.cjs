"use strict";
// tsc's emit for `import asCallback from "./stamped.cjs"`: the helper, then the call through a comma.
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const stamped_1 = __importDefault(require("./stamped.cjs"));
const plain_1 = __importDefault(require("./plain.cjs"));

const log = [];
/** @param {(err: Error | null, v?: number) => void} cb @returns {Promise<number>} */
async function run(cb) {
  return (0, stamped_1.default)(new Promise((r) => r(5)), cb);
}
run((e, v) => log.push("cb " + e + " " + v)).then((v) => log.push("then " + v));
log.push("sync " + (0, plain_1.default)(1) + " " + typeof stamped_1.default + " " + typeof plain_1.default);
(async () => {
  for (let i = 1; i <= 4; i++) {
    await null;
    log.push("t" + i);
  }
  console.log(log.join("\n"));
})();
