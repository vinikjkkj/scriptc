"use strict";
var _a;
const sym_1 = require("./sym.cjs");
class Client {
  constructor() {
    this.name = "c";
    this[_a] = false;
    this.after = 1;
  }
  arm() { this[sym_1.hasX] = true; }
  armed() { return this[sym_1.hasX]; }
}
_a = sym_1.hasX;
function run() {
  const c = new Client();
  console.log(c.armed(), c.name, c.after);
  c.arm();
  console.log(c.armed());
  console.log(c);
}
exports.run = run;
