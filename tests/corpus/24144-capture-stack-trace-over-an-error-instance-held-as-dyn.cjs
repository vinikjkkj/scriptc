"use strict";
// Error.captureStackTrace over a class instance that extends Error and is held as a dynamic value (pg-protocol
// captures on its DatabaseError after a handoff through untyped code): the instance keeps its message and name.
class DbErr extends Error {
  constructor(message, name) { super(message); this.name = name; }
}
function capture(target) { Error.captureStackTrace(target); return target; }
const e = capture(new DbErr("dup key", "error"));
console.log(e instanceof Error, e.name, e.message, typeof e.stack, e.stack.split("\n")[0]);
