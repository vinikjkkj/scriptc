"use strict";
// Error.captureStackTrace(holder, fn) with a plain object as the holder (mysql2's promise wrapper:
// `const holder = {}; Error.captureStackTrace(holder, constructorOpt); return holder;`).
// The header is formatted AT THE CALL from the holder's name and message, and `stack` is an own
// non-enumerable property. Frame lines are V8's, so only the first line is compared.
/** @param {Function} constructorOpt */
function captureStackHolder(constructorOpt) {
  const holder = {};
  Error.captureStackTrace(holder, constructorOpt);
  return holder;
}
/**
 * @param {Error} err
 * @param {{ stack?: string }} holder
 */
function applyCapturedStack(err, holder) {
  const stack = holder && holder.stack;
  if (typeof stack !== "string" || !stack) return "no stack";
  const lines = stack.split("\n");
  lines[0] = `${err.name}: ${err.message}`;
  return lines[0];
}
class Wrapper {
  query() { return captureStackHolder(Wrapper.prototype.query); }
}
const h = new Wrapper().query();
console.log(typeof h.stack, h.stack.split("\n")[0]);
console.log(applyCapturedStack(new Error("boom"), h));
console.log(Object.keys(h), JSON.stringify(h), "stack" in h, h.hasOwnProperty("stack"));
const named = { name: "Foo", message: "bar" };
Error.captureStackTrace(named);
console.log(named.stack.split("\n")[0]);
named.message = "later";
console.log(named.stack.split("\n")[0], Object.keys(named).join());
const onlyMessage = { message: "m" };
Error.captureStackTrace(onlyMessage);
console.log(onlyMessage.stack.split("\n")[0]);
const onlyName = { name: "X" };
Error.captureStackTrace(onlyName, captureStackHolder);
console.log(onlyName.stack.split("\n")[0]);
const custom = { toString() { return "custom!"; } };
Error.captureStackTrace(custom);
console.log(custom.stack.split("\n")[0]);
const empty = { name: "", message: "just a message" };
Error.captureStackTrace(empty);
console.log(JSON.stringify(empty.stack.split("\n")[0]));
named.stack = "replaced";
console.log(named.stack);
Error.captureStackTrace(named);
console.log(named.stack.split("\n")[0]);
try {
  Error.captureStackTrace(5);
} catch (e) {
  console.log(e.name, e.message);
}
