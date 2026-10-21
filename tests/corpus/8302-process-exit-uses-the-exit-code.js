// @exit: 6
// process.exit() with no argument ends with process.exitCode; process.exit(n)
// assigns it first (so the 'exit' listener and a later read see n) and
// validates it like the setter; a listener that assigns process.exitCode
// changes the final status; process.exit() inside a listener is the same
// exit, not a second one. Node is the oracle for stdout and the status.
"use strict";

process.on("exit", (code) => {
  console.log("listener", code, process.exitCode);
  if (code === 4) {
    process.exitCode = 6;
    process.exit();
  }
});

try {
  process.exit("x");
} catch (e) {
  console.log(e.name, e.code);
}
try {
  process.exit(2.5);
} catch (e) {
  console.log(e.name, e.code);
}
console.log("still running", process.exitCode);
process.exitCode = 3;
setTimeout(() => {
  console.log("timer", process.exitCode);
  process.exitCode = 4;
  process.exit();
  console.log("never");
}, 5);
