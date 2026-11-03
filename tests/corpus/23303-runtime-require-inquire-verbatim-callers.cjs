// protobufjs's inquire(), verbatim, with the callers protobufjs itself has when
// the optional modules are absent: a plain function declaration, called with
// constants nothing resolves, and one call that leaves its result unused.
"use strict";
function inquire(moduleName) {
  try {
    if (typeof require !== "function") return null;
    var mod = require(moduleName);
    return mod && (mod.length || Object.keys(mod).length) ? mod : null;
  } catch (e) { /* Node's MODULE_NOT_FOUND: protobufjs swallows it */ }
  return null;
}
var Long = inquire("long");
var deep = inquire("no-such-pkg-xyz/deeper");
inquire("@nope/nothing");
console.log(typeof require, String(Long), String(deep), Long === null);
