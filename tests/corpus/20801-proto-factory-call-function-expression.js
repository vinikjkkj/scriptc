// A prototype method installed from a factory that returns a function expression.
// The installed function reads `this`, which must be the receiver of the call.
"use strict";
class Client {
  constructor() { this.n = 41; }
}
function generateFunction(name) {
  return function (x) {
    return name + ":" + (this.n + x);
  };
}
Client.prototype.call = generateFunction("call");
const a = new Client();
const b = new Client();
b.n = 7;
console.log(a.call(1), b.call(1));
