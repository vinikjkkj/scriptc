// The function-literal const whose parameters include a REST parameter
// (`const f = (...a) => ...`) read from function declarations: the slot is
// the checked-dynamic function value, calls pass any number of arguments.
// Node is the oracle.
"use strict";

const rec = (...a) => a.length + ":" + a.join("|");
const first = (head, ...rest) => head + "+" + rest.length;
function useIt() {
  return rec(1, "x") + " " + rec() + " " + first("h") + " " + first("h", 1, 2);
}
console.log(useIt());
function later() {
  return rec("late");
}
console.log(later());
