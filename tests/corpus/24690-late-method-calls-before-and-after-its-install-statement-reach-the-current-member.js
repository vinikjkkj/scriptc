// A LATE method (`C.prototype.m = function ...`) over a class chain with a run-time prototype table (ioredis Commander/Pipeline): calls made
// BEFORE the install statement reach the table's current member and see the call's full argument list, calls AFTER reach the replacement
// (subclass instances too), a replacement may wrap the original read above it, and a member nothing provides yet throws a TypeError.
class Commander { constructor() { this.tag = "c"; } }
["get", "multi", "exec", "pipeline"].forEach(function (name) {
  Commander.prototype[name] = function (...args) { return name + ":" + args.join("|") + ":" + this.tag; };
});
class Pipeline extends Commander { constructor() { super(); this.n = 0; } }
class Sub extends Pipeline {}
const p = new Pipeline();
const s = new Sub();
// calls BEFORE the install statements: the table's members
console.log(p.multi(), p.multi("a", 2), s.exec("z"), p.get("k"));
function attempt(f) { try { return f(); } catch (e) { return e.constructor.name + ": " + e.message; } }
console.log(attempt(() => p.pipeline("x")));
// a member neither the table nor an install provides yet: Node throws a TypeError (its message names the call-site spelling, which a
// dispatcher cannot know, so only the error class is pinned here)
console.log(attempt(() => p.onlyLate(1)).split(":")[0]);
const multi = Pipeline.prototype.multi;
Pipeline.prototype.multi = function () { this.n += 1; return multi.apply(this, arguments) + "!" + this.n; };
const exec = Pipeline.prototype.exec;
Pipeline.prototype.exec = function (callback) { this.n += 10; return exec.call(this, callback) + "#" + arguments.length + "#" + this.n; };
Pipeline.prototype.pipeline = function () { return "own pipeline " + this.tag; };
Pipeline.prototype.onlyLate = function (v) { return "late " + v + this.tag; };
// calls AFTER: the replacements, through the subclass too
console.log(p.multi(), p.multi("x", 2), s.multi("q"));
console.log(p.exec("cb"), s.exec());
console.log(p.pipeline(), s.pipeline(), p.get("k"), p.onlyLate(2), s.onlyLate(3));
