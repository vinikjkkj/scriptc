"use strict";
// Error.captureStackTrace over a class instance that extends Error and is held as a dynamic value (pg-protocol
// captures on its DatabaseError after a handoff through untyped code): the instance keeps its message and name.
class DbErr extends Error {
  constructor(message, name) { super(message); this.name = name; }
}
function capture(target) { Error.captureStackTrace(target); return target; }
const e = capture(new DbErr("dup key", "error"));
console.log(e instanceof Error, e.name, e.message, typeof e.stack, e.stack.split("\n")[0]);
// the capture re-forms the header from the CURRENT name and message
const f = capture(new DbErr("dup key", "error"));
console.log(f.stack.split("\n")[0]);
f.name = "renamed";
console.log(f.stack.split("\n")[0]);
capture(f);
console.log(f.stack.split("\n")[0]);
console.log(Object.keys(f).join(","));
