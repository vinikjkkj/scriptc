// Instances of classes extending Error, EventEmitter and Readable carry symbol-keyed own properties written and read through untyped receivers and through the typed class.
"use strict";
const { EventEmitter } = require("node:events");
const { Readable } = require("node:stream");
const kTag = Symbol("tag"), kCode = Symbol.for("code");
class MongoError extends Error {
  constructor(msg) { super(msg); this.name = "MongoError"; }
}
class Net extends EventEmitter {
  constructor() { super(); this.n = 1; }
}
class Feed extends Readable {
  constructor() { super(); this.f = 2; }
  _read() {}
}
function tag(o, v) { o[kTag] = v; o[kCode] = v + 1; return o; }
function read(o) { return [o[kTag], o[kCode], kTag in o, Object.hasOwn(o, kCode), Object.getOwnPropertySymbols(o).filter((s) => s === kTag || s === kCode).length]; }
const e = tag(new MongoError("boom"), 10);
const n = tag(new Net(), 20);
const f = tag(new Feed(), 30);
console.log(read(e), read(n), read(f));
console.log(read(new MongoError("fresh")), read(new Net()), e.message, n.n, f.f);
const typed = new MongoError("typed");
typed[kTag] = 5;
console.log(typed[kTag], kTag in typed);
