// A function a constructor assigns over a method inherited from a base runs with the instance as `this`
// (`obj.m()` on an own property function), including when it throws and when it nests another instance's call.
class P {
  constructor() { this.n = 1; }
  exec(cb) { return "base:" + this.n + ":" + cb; }
}
class Q extends P {
  constructor(tag) {
    super();
    this.tag = tag;
    this.exec = function (cb) {
      if (cb === "boom") throw new Error("boom:" + this.tag);
      if (cb === "nest") return "nest(" + this.tag + ")[" + new Q("inner").exec("x") + "]";
      return "own:" + this.tag + ":" + this.n + ":" + cb;
    };
  }
}
class R extends P {
  constructor() {
    super();
    this.exec = (cb) => "arrow:" + cb;
  }
}
const q = new Q("a");
const p = new P();
console.log(q.exec("one"), p.exec("one"), new R().exec("two"));
console.log(q.exec("nest"));
try { q.exec("boom"); } catch (e) { console.log(e.message); }
// the window closed after the throw: a later call sees the right receiver
const q2 = new Q("b");
q2.n = 7;
console.log(q2.exec("two"), q.exec("three"));
const asP = q2;
console.log(asP.exec("viaBase"));
