// The decorator idiom: the replacement wraps the original, installed under a run-time condition, twice (wrapping the wrapper).
class Svc {
  constructor(n) { this.n = n; this.log = []; }
  run(x) { this.log.push("run" + x); return this.n + x; }
  stop() { return "stop:" + this.n; }
}
const s0 = new Svc(10);
console.log(s0.run(1), s0.log.join(","));
const installed = [];
function install(label, on) {
  if (!on) return;
  const old = Svc.prototype.run;
  Svc.prototype.run = function (x) {
    const r = old.call(this, x);
    installed.push(label);
    return r * 2;
  };
}
install("a", false);
console.log(new Svc(1).run(1), installed.join(","));
install("b", true);
console.log(new Svc(1).run(1), s0.run(2), installed.join(","));
install("c", true);
const s1 = new Svc(3);
console.log(s1.run(4), s1.log.join(","), s1.stop(), installed.join(","));
try {
  Svc.prototype.run = function () { throw new Error("boom:" + this.n); };
  s1.run(1);
} catch (e) { console.log("caught", e.message); }
