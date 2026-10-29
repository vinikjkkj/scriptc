class Base {
  n: number;
  constructor(n: number) {
    this.n = n;
    console.log("base", n);
  }
}
function arg(x: number): number { console.log("arg", x); return x; }
class T extends Base {
  constructor(c: boolean) {
    super(arg(1));
    if (c) {
      super(arg(2));
    }
    console.log("unreached?", this.n);
  }
}
new T(false);
try { new T(true); } catch (e) { console.log((e as Error).constructor.name, (e as Error).message); }
