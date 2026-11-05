"use strict";
// tsc's emit for `import asCallback from "./impdep"`, in a package that ships a declaration file.
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.run = run;
const impdep_1 = __importDefault(require("./impdep"));
function run(value, nodeback) {
  return (0, impdep_1.default)(new Promise((resolve) => resolve(value)), nodeback);
}
