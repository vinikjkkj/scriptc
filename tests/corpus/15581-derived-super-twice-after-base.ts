class Base {
  n: number;
  constructor(n: number) {
    this.n = n;
    console.log("base", n);
  }
}
function arg(x: number): number { console.log("arg", x); return x; }
class F extends Base {
  constructor(c: boolean) {
    if (c) {
      super(arg(1));
    }
    super(arg(2));
  }
}
new F(false);
try { new F(true); } catch (e) { console.log((e as Error).constructor.name, (e as Error).message); }
