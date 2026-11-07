// The TypeError a call raises when a late method's table has no member yet names the CALL SITE's spelling, as V8 renders it: a plain chain,
// a subclass receiver, a string-literal key (printed dotted), odd whitespace, a parenthesised receiver, and `this.inner.m`.
class Commander { constructor() { this.tag = "c"; this.inner = null; } }
["get"].forEach(function (name) { Commander.prototype[name] = function () { return name + this.tag; }; });
class Pipeline extends Commander { constructor() { super(); this.inner = this; } probe() { return attempt(() => this.inner.missing("a")); } }
class Sub extends Pipeline {}
const p = new Pipeline();
const s = new Sub();
const key = "missing";
function attempt(f) { try { return f(); } catch (e) { return e.constructor.name + ": " + e.message; } }
console.log(attempt(() => p.missing(1)));
console.log(attempt(() => s.missing(2, 3)));
console.log(attempt(() => p["missing"]("x")));
console.log(attempt(() => p . missing ()));
console.log(attempt(() => (p).missing()));
console.log(p.probe());
console.log(attempt(() => p.get() + p.missing(4)));
Pipeline.prototype.missing = function (a) { return "installed " + a + this.tag; };
console.log(p.missing(5), s.missing(6), p["missing"](7));
