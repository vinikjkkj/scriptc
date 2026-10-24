"use strict";
// Error.stackTraceLimit is a process-wide number: V8's default, and whatever the
// program stores. Libraries lower it around a construction to skip the capture.
console.log(typeof Error.stackTraceLimit, Error.stackTraceLimit);
const saved = Error.stackTraceLimit;
Error.stackTraceLimit = 2;
console.log(Error.stackTraceLimit, saved);
Error.stackTraceLimit = 0;
const e = new Error("quiet");
console.log(e.message, Error.stackTraceLimit);
Error.stackTraceLimit = saved;
function build(limit, msg) {
  const before = Error.stackTraceLimit;
  Error.stackTraceLimit = limit;
  const err = new RangeError("range-" + msg);
  Error.stackTraceLimit = before;
  return err.message + "@" + limit + "/" + Error.stackTraceLimit;
}
console.log(build(1, "a"), build(5, "b"));
