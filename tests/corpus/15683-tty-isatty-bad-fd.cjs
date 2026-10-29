// Node answers false, never throws, for a fd that is not an integer in 0..2147483647,
// through the value form: NaN, Infinity, a fraction, a negative, and a number past
// the int32 range.
const tty = require("tty");
const isatty = tty.isatty;
const big = 2147483647 + 1;
console.log(isatty(NaN), isatty(Infinity), isatty(-Infinity), isatty(0.5), isatty(-7), isatty(big));
