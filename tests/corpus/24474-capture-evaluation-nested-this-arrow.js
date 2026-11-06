// nested this in arrow (attached clone), array callbacks
function make(prefix, n) {
  class C {
    constructor() { this.v = n; this.xs = [1, 2]; }
    viaArrow() { return this.xs.map((x) => prefix + x + this.v + n).join(","); }
    capArrow() { return [1, 2].map((x) => prefix + x).join(","); }
  }
  return new C();
}
const a = make("p", 1), b = make("q", 2);
const viaArrow = a.viaArrow, capArrow = a.capArrow;
try { console.log(viaArrow()); } catch (e) { console.log("T", e.name); }
console.log(viaArrow.call(b));
console.log(capArrow(), capArrow.call(b));
