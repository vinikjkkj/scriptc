// this.method read as a callback inside the class, an instance method value through a polymorphic receiver.
class C {
  items = [1, 2, 3];
  scale = 10;
  double(x: number) { return x * 2; }
  scaled(x: number) { return x * this.scale; }
  run() {
    const out: number[] = [];
    out.push(...this.items.map(this.double));
    try { this.items.map(this.scaled); } catch (e: any) { out.push(-1); console.log(e.name); }
    out.push(...this.items.map(this.scaled.bind(this)));
    const f = this.double;
    out.push(f(4), f.call(null, 5), this.double === f ? 1 : 0);
    return out;
  }
  static twice(x: number) { return x * 2; }
  static useStatic() { return [1, 2].map(C.twice); }
}
console.log(new C().run(), C.useStatic());
class D extends C { double(x: number) { return x * 3; } }
const dd = new D();
const fd = dd.double;
console.log(fd(2), new D().run());
let polymorphic: C = Math.random() > 2 ? new C() : new D();
console.log([1, 2].map(polymorphic.double));
