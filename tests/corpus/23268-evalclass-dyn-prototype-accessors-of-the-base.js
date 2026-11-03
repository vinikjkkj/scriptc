// A base class with accessors, the pg-pool shape: the evaluated subclass's prototype links to the base's, whose getters and
// setter are accessor properties answering on instances and throwing on the prototype itself.
function anyv(x) { return x; }
class Pool { constructor() { this._q = [1, 2]; this._v = 0; }
  get waiting() { return this._q.length; }
  get v() { return this._v; } set v(x) { this._v = x; }
  run() { return "run"; } }
const mk = (tag = "t") => class Bound extends Pool { constructor(o) { super(); this.o = o; } tagged() { return tag + this.waiting; } };
const h = {}; h.B = mk("x");
const B = anyv(h.B), PP = anyv(Pool);
const b = new B(1);
console.log(B.prototype.tagged.call(b), Object.getOwnPropertyNames(PP.prototype), Object.keys(B.prototype));
try { console.log(B.prototype.waiting); } catch (e) { console.log(e.name); }
console.log("waiting" in B.prototype, Object.hasOwn(PP.prototype, "waiting"), Object.hasOwn(B.prototype, "waiting"));
