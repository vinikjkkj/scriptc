// The Promise statics on a receiver that is not the Promise constructor: each one runs NewPromiseCapability(C), constructing C through its
// own construction with a capability executor (resolve, reject, withResolvers, try and the combinators), and a receiver that cannot be one
// throws V8's TypeError ("... is not a constructor", "Promise resolve or reject function is not callable").
// The statics on a receiver that is not the Promise constructor: NewPromiseCapability(C) through C's own construction.
const P = Promise;
function L(a, b) { return b === undefined ? [a] : [a, b]; }
function D(x) { return x; }
function Good(executor) {
  this.log = [];
  const self = this;
  executor((v) => self.log.push("res:" + v), (r) => self.log.push("rej:" + r));
}
Good.resolve = function (x) { return P.resolve(x); };

const a = D(Promise.resolve.call(Good, 5));
console.log(a instanceof Good, a.log.join());
const b = D(Promise.reject.call(Good, "no"));
console.log(b instanceof Good, b.log.join());
const same = D(Promise.resolve.call(Good, a));
console.log(same === a);
const wr = D(Promise.withResolvers.call(Good));
console.log(Object.keys(wr).join(), wr.promise instanceof Good, typeof wr.resolve);
wr.resolve(7);
console.log(wr.promise.log.join());
const t = D(Promise.try.call(Good, (x, y) => x + y, 2, 3));
console.log(t instanceof Good, t.log.join());
const te = D(Promise.try.call(Good, () => { throw new Error("tried"); }));
console.log(te.log.length, te.log[0].startsWith("rej:Error: tried"));

const all = D(Promise.all.call(Good, L(1, P.resolve(2))));
const race = D(Promise.race.call(Good, L(P.resolve("r1"), 2)));
const settled = D(Promise.allSettled.call(Good, L(1, P.reject("e"))));
const any = D(Promise.any.call(Good, L(P.reject(1), 9)));
const anyFail = D(Promise.any.call(Good, L(P.reject(1))));
const empty = D(Promise.all.call(Good, []));
const bad = D(Promise.all.call(Good, 5));
setTimeout(() => {
  console.log("all", all instanceof Good, all.log.join("|"));
  console.log("race", race.log.join("|"));
  console.log("settled", settled.log.join("|"));
  console.log("any", any.log.join("|"));
  console.log("anyFail", anyFail.log.length, anyFail.log[0].slice(0, 20));
  console.log("empty", empty.log.join("|"));
  console.log("bad", bad.log.join("|"));
}, 5);

function tryit(label, C, m, arg) {
  try { const r = Promise[m].call(C, arg); console.log(label, m, "ok", typeof r); } catch (e) { console.log(label, m, e.constructor.name + ": " + e.message); }
}
const notCtor = () => 1;
function noExec(ex) {}
function badExec(ex) { ex(1, 2); }
for (const m of ["resolve", "reject", "withResolvers"]) {
  tryit("obj", {}, m, 1);
  tryit("arrow", notCtor, m, 1);
  tryit("noExec", noExec, m, 1);
  tryit("badExec", badExec, m, 1);
}
tryit("obj", {}, "all", []);
tryit("noExec", noExec, "race", []);
