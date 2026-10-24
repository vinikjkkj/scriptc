const order = [];
// The print is armed FROM the immediate, not beside it: an immediate runs in
// the check phase and a 5 ms timer in the timers phase, and when startup
// takes longer than 5 ms the timer fires first and prints an empty order
// (Node documents setTimeout-vs-setImmediate order as bound by process
// performance). Registering the timer inside the immediate makes the print
// causal: it can only follow the push.
setImmediate((a, b) => {
  order.push('imm ' + a + b);
  setTimeout(() => console.log(order.join('|')), 5);
}, 'x', 'y');
