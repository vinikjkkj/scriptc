// A tty member read as a value and called through a stored function variable
// (a lookup table of checks picked at run time), with the fd coming from a loop.
const tty = require("tty");
const checks = [tty.isatty, tty.isatty];
let n = 0;
for (let fd = 0; fd < 3; fd++) {
  const check = checks[fd % 2];
  if (check(fd + 100) === false) n++;
}
console.log("false answers", n, checks[0] === checks[1]);
