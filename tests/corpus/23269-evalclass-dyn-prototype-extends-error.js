// An evaluated class extending Error: its prototype's own constructor, own names, and the link to Error.prototype.
function anyv(x) { return x; }
const mkErr = (code = "E") => class AppError extends Error { constructor(msg) { super(msg); this.code = code; } describe() { return "d" + this.code; } };
const h = {}; h.E = mkErr("X1");
const E = anyv(h.E);
const P = E.prototype;
console.log(P.constructor === E, Object.keys(P), P.name, P.message === "", typeof P.toString, Object.getOwnPropertyNames(P));
const e = new E("boom");
console.log(P.describe.call(e), e instanceof E, e instanceof Error);
