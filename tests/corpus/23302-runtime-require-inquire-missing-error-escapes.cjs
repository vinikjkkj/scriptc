// A run-time-specifier require WITHOUT the swallowing catch: every call site
// passes a constant Node cannot resolve, so the error that escapes is Node's
// MODULE_NOT_FOUND for exactly the specifier handed in (code and first message
// line; the second line carries a path and is not printed).
"use strict";
function load(name) {
  return require(name);
}
function firstLine(s) { return String(s).split("\n")[0]; }
for (const run of [() => load("no-such-pkg-xyz"), () => load("@nope/nothing"), () => load("./no-such-file"), () => load("no-such-pkg-xyz")]) {
  try {
    run();
    console.log("GOT");
  } catch (e) {
    console.log(e.code, "|", firstLine(e.message), "|", e instanceof Error);
  }
}
const alias = load;
try { alias("zz-yy-xx"); } catch (e) { console.log(e.code, firstLine(e.message)); }
