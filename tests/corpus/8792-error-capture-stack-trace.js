"use strict";
// Error.captureStackTrace(this, this.constructor) in an Error subclass constructor (the
// spelling ioredis, node-redis, mongodb and most applications use). The frame lines are
// V8's and a compiled binary has none, so only the header line (the first line, formatted
// from the name and message at the FIRST READ, which V8 postpones) is observable here, and
// it must agree.
class AppError extends Error {
  constructor(message) {
    super("" + message);
    Error.captureStackTrace(this, this.constructor);
  }
}
class LimitError extends AppError {
  get name() { return this.constructor.name; }
}
class Late extends Error {
  constructor(message) {
    super("" + message);
    Error.captureStackTrace(this);
    this.name = "Renamed";
  }
}
/** @param {Error} e */
const first = (e) => String(e.stack).split("\n")[0];
const a = new AppError("plain");
const l = new LimitError("limit reached");
const late = new Late("late");
console.log(typeof a.stack, first(a));
console.log(first(l), l.name);
console.log(first(late), late.name);
console.log(first(new AppError("again")), first(a) === first(a));
