// tty.isatty taken as a VALUE and kept in a record (the debug shape: a function
// member stored once and called later): identity, typeof, and Node's answers
// for fds that are not an integer in 0..2147483647 (false, never a throw).
const tty = require("tty");
const isatty = tty.isatty;
console.log(typeof isatty, isatty === tty.isatty);
const impl = { isatty: tty.isatty };
console.log(impl.isatty === isatty);
console.log(isatty(99), isatty(-1), isatty(1.5), isatty(NaN), isatty(2147483648));
console.log(impl.isatty(99), impl.isatty(-0));
