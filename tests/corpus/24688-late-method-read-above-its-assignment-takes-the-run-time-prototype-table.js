// A class whose prototype table is built at run time (a loop over a constant name list, ioredis Commander) and a subclass that reads an
// inherited member ABOVE its own late assignment, then replaces it with a wrapper forwarding `arguments`: the read is the table's function,
// not the replacement it is about to become.
class Commander { constructor() { this.tag = "c"; } }
const commands = ["get", "set", "multi", "exec"];
commands.forEach(function (name) {
  Commander.prototype[name] = function (...args) { return name + ":" + args.join("|") + ":" + this.tag; };
});
class Pipeline extends Commander { constructor() { super(); this.n = 0; } }
const multi = Pipeline.prototype.multi;
Pipeline.prototype.multi = function () { this.n += 1; return multi.apply(this, arguments) + "!" + this.n; };
const p = new Pipeline();
console.log(p.get("a"), p.set("b", 1));
console.log(p.multi(), p.multi("x", 2));
console.log(p.exec());
