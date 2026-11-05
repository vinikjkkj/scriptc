"use strict";
// tsc's emit for a class field keyed by a symbol another module exports, in a package that ships declaration files, plus the
// statics tsc places after the class.
Object.defineProperty(exports, "__esModule", { value: true });
exports.Client = void 0;
var _a;
const symmod_1 = require("./symmod");
class Client {
  constructor(label) {
    this.label = label;
    this[_a] = false;
  }
  flagged() {
    return this[symmod_1.hasFlag] === true;
  }
  mark() {
    this[symmod_1.hasFlag] = true;
  }
  describe() {
    return this.label + ":" + Client.defaults.port + ":" + Client.tag;
  }
}
exports.Client = Client;
_a = symmod_1.hasFlag;
Client.tag = "t";
Client.defaults = { port: 6379 };
