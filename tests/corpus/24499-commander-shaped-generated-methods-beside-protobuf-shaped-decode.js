// ioredis's Commander declares `call`/`callBuffer` as prototype data built by a generator; a protobuf-shaped decoder elsewhere in the
// program stores a possibly-undefined value to a property of the same name. Neither makes the program inexact.
function generateFunction(name, encoding) { return function (...args) { return name + "/" + encoding + "/" + args.join(); }; }
class Commander { constructor() { this.status = "wait"; } }
Commander.prototype.call = generateFunction("call", "utf8");
Commander.prototype.callBuffer = generateFunction("callBuffer", null);
class Redis extends Commander { constructor() { super(); this.opts = { db: 0 }; } }
function decode(buf, a) { a = a || {}; for (const part of buf) { const [k, v] = part.split("="); if (k === "call") a.call = v === "" ? undefined : v; } return a; }
function viaAny(c) { return c.call("any"); }
function viaAny2(c) { return c.callBuffer("buf"); }
const r = new Redis(), plain = decode(["call=x"]), none = decode(["call="]);
console.log(viaAny(r), viaAny2(r), plain.call, none.call, "call" in none, Object.hasOwnProperty.call(none, "call"));

console.log(viaAny(new Commander()));
function own(c, k) { return Object.hasOwnProperty.call(c, k); }
console.log(own(r, "call"), own(r, "callBuffer"), own(none, "call"));
