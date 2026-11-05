"use strict";
// A function value with an OWN `toString` answers ToString with it (generate-function's builder: `line.toString` joins the
// lines it was fed), through every spelling: the call, String(), concatenation and a template.
function builder() {
  var lines = [];
  var line = function (x) { lines.push(x); return line; };
  line.toString = function () { return lines.join("\n"); };
  line.toFunction = function () { return new Function("return (" + line.toString() + ")")(); };
  return line;
}
const g = builder();
g("function (a, b) {")("return a * b")("}");
console.log(g.toString());
console.log(String(g));
console.log("" + g);
console.log(`${g}`);
console.log(g.toFunction()(6, 7));
function plain(a) { return a; }
console.log(String(plain));
console.log(plain.toString());
