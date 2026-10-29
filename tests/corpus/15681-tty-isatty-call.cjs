// tty.isatty called on a non-literal fd (debug src/node.js:158 shape: tty.isatty(fd) where
// fd is a run-time value) inside a branch that prefers an explicit colors option. Only
// types are printed, so the answer does not depend on how the harness attaches stdio.
const tty = require("tty");
function useColors(opts, fd) {
  return "colors" in opts ? Boolean(opts.colors) : tty.isatty(fd);
}
console.log(useColors({ colors: true }, 2), useColors({ colors: false }, 2));
console.log(typeof useColors({}, 2));
let fd = 0;
for (let i = 0; i < 3; i++) fd = fd + 1;
console.log(typeof tty.isatty(fd), tty.isatty(fd) === tty.isatty(fd + 0));
