class RedisError extends Error {
  constructor(message) { const tmp = Error.stackTraceLimit; Error.stackTraceLimit = 2; super(message); Error.stackTraceLimit = tmp; }
  get name() { return this.constructor.name; }
}
class ReplyError extends RedisError { constructor(m) { super(m); this.extra = 5; } static make(m) { return new ReplyError(m); } }
class AbortError extends RedisError {}
class NoCtor extends Error {}
function build(Ctor, msg) { return new Ctor(msg); }
function show(k, C) {
  const e = build(C, "m-" + k);
  console.log(k, e.name, e.message, e instanceof C, e instanceof RedisError, e instanceof Error, C.name, String(e));
}
show("RedisError", RedisError); show("ReplyError", ReplyError); show("AbortError", AbortError); show("NoCtor", NoCtor);
console.log(ReplyError.make("zz").extra, typeof ReplyError);
function check(e, C) { return e instanceof C; }
console.log(check(new AbortError("a"), RedisError), check(new AbortError("a"), ReplyError));
module.exports = { RedisError, ReplyError };
const M = require("./23350-builtin-error-class-values-redis-shape.cjs");
console.log(M.ReplyError === ReplyError, new M.ReplyError("w").message);
const st = new ReplyError("zz").stack; console.log(typeof st, String(st).split("\n")[0]);
