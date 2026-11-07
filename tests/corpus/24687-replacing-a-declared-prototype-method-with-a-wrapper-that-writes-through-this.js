// `C.prototype.m = function () { this.f += 1; ... }` replaces a declared method at run time and the replacement writes the receiver's
// fields: the receiver reaches it as `this`, the write lands in the instance's real field, subclasses that do not override see it, and
// the original (read before the write) stays callable.
class P {
  constructor() {
    this.tag = "p";
    this._t = 0;
  }
  go(x) {
    return "go " + this.tag + x;
  }
  count() {
    return this._t;
  }
}
const go = P.prototype.go;
P.prototype.go = function (x) {
  this._t += 1;
  this.last = x;
  return go.call(this, x) + " t=" + this._t;
};
const p = new P();
console.log(p.go(1), p.go(2), p.count());
class Q extends P {}
const q = new Q();
console.log(q.go(3), q.count());
class R extends P {
  go(x) {
    return "R:" + super.go(x);
  }
}
console.log(new R().go(4));
console.log(go.call(new P(), 5), p.count());
