// A getter of the object runs at each READ of the member through the view, not once at the cast; a setter
// runs at each write.
class Counter {
  n = 0;
  reads = 0;
  _l = "init";
  get next(): number {
    this.reads++;
    return ++this.n;
  }
  get label(): string {
    return this._l;
  }
  set label(v: string) {
    this._l = "set:" + v;
  }
  bump(by: number): number {
    this.n += by;
    return this.n;
  }
}
interface V { n: number; next: number; label: string; reads: number }
function make(): unknown {
  return new Counter();
}
const inst = make();
const v = inst as V;
console.log(v.reads);
console.log(v.next, v.next, v.reads, v.n);
v.label = "x";
console.log(v.label, (inst as Counter).label);
(inst as Counter).n = 100;
console.log(v.n, v.next);
v.n = 5;
console.log((inst as Counter).n);
