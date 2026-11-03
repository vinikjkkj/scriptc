// The optional-dependency idiom through a parameter: every call site passes a
// constant Node cannot resolve, including names that merely LOOK like an
// installed package (a prefix of one, one a prefix of), so the run-time-specifier
// require is Node's catchable MODULE_NOT_FOUND for exactly the name handed in.
"use strict";
function firstLine(s) { return String(s).split("\n")[0]; }
function tryRequire(spec) {
  try {
    var mod = require(spec);
    return "GOT " + typeof mod;
  } catch (e) {
    return e.code + " | " + firstLine(e.message);
  }
}
console.log("L4", tryRequire("no-such-pkg-xyz"));
console.log("L5", tryRequire("@nope/nothing"));
console.log("L6", tryRequire("@nope/nothing/deeper"));
console.log("L7", tryRequire("vites"));
console.log("L8", tryRequire("vitestxyz"));
console.log("L19", tryRequire("no-such-pkg-xyz") === tryRequire("no-such-pkg-xyz"));
