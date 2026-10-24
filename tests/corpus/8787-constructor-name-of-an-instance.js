"use strict";
// `x.constructor.name` over a class instance is the name of its DYNAMIC class: read in
// a base constructor, in a method, and through a getter that makes every subclass
// answer to its own name (the redis-errors idiom). Classes in no hierarchy answer too.
class Reader {
  constructor() { this.seenAtConstruction = this.constructor.name; }
  who() { return this.constructor.name; }
}
class Middle extends Reader {}
class Leaf extends Middle {
  constructor() {
    super();
    this.mine = this.constructor.name;
  }
}
const leaf = new Leaf();
console.log(leaf.seenAtConstruction, leaf.mine, leaf.who(), new Middle().seenAtConstruction, new Reader().who());

class Solo { label() { return this.constructor.name; } }
console.log(new Solo().label());

class NamedError extends Error {
  get name() { return this.constructor.name; }
}
class ReplyError extends NamedError {
  constructor(message) {
    const tmp = Error.stackTraceLimit;
    Error.stackTraceLimit = 2;
    super(message);
    Error.stackTraceLimit = tmp;
  }
  get name() { return this.constructor.name; }
}
class SimpleError extends ReplyError {}
const e = new SimpleError("boom");
console.log(e.name, e.message, String(e), e instanceof Error, e instanceof ReplyError);
console.log(new ReplyError("r").name, new NamedError("n").name);
console.log(e.constructor.name, new Error("x").constructor.name, new TypeError("t").constructor.name, new RangeError("r").constructor.name);
