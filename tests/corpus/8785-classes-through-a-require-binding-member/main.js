"use strict";
// Classes reached through a require binding's member (`errors_1.ReplyError`), the
// way tsc-compiled packages spell every cross-file class: construction, instanceof
// and `extends`, over a hierarchy rooted at Error (which has no class value) and
// over a plain one.
const errors_1 = require("./errors");
const r = new errors_1.ReplyError("down");
console.log(r.message, r.replied, r.tag(), r instanceof errors_1.ReplyError, r instanceof errors_1.BaseError, r instanceof Error);
class Sub extends errors_1.ReplyError {
  constructor(m) { super(m + "!"); }
}
const s = new Sub("sub");
console.log(s.message, s.replied, s instanceof Sub, s instanceof errors_1.ReplyError, new errors_1.BaseError("b") instanceof Sub);
const p = new errors_1.PlainChild(7);
console.log(p.v, p instanceof errors_1.Plain, p instanceof errors_1.PlainChild, new errors_1.Plain(1) instanceof errors_1.PlainChild);
try {
  throw new errors_1.ReplyError("thrown");
} catch (e) {
  console.log(e instanceof errors_1.ReplyError ? "caught " + e.message : "other");
}
