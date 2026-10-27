// encodings/utf7.js:30 shape: an untyped replacer, bound to this, over a global regex.
var nonDirectChars = /[^A-Za-z0-9'(),-./:? \n\r\t]+/g;
function Enc(tag) { this.tag = tag; }
Enc.prototype.write = function (str) {
  return str.replace(nonDirectChars, function (chunk) {
    return "+" + (chunk === "+" ? "" : this.tag + chunk.length) + "-";
  }.bind(this));
};
console.log(new Enc("T").write("ab cd!ef+g"));
console.log("x1y22z".replace(/\d+/g, function (m) { return "[" + m + "]"; }));
