// CommonJS: the same factory-installed method, with the class exported and used locally.
"use strict";
class Store {
  constructor() { this.options = { keyPrefix: "t:" }; }
}
function generateFunction(name, encoding) {
  return function (...args) {
    return [name, encoding, this.options.keyPrefix, args.length].join("|");
  };
}
Store.prototype.call = generateFunction("call", "utf8");
Store.prototype.callBuffer = generateFunction("callBuffer", null);
module.exports = Store;
const s = new Store();
console.log(s.call("get", "k"), s.callBuffer());
