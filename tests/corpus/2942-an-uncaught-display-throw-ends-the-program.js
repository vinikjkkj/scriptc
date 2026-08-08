// @exit: 1
// An UNCAUGHT throw from inside a display walker ends the program, the
// way every other uncaught exception does. This is the shape the whole
// item was filed against: the walker appended the empty string and left
// the exception in the cell, so `console.log(String(v))` printed a BLANK
// LINE, the statement after it ran, and the process exited 0 — a designed
// refusal turned into a silent wrong answer. stderr differs from Node's
// (the uncaught-report format is a documented divergence), so this
// program is compared on stdout and the exit code.
function boxed(v) {
  return v;
}
var doomed = boxed({
  toString: function () {
    throw new TypeError("this value has no string form");
  },
});
console.log("before");
console.log(String(doomed));
console.log("after — this line must NOT be reached");
