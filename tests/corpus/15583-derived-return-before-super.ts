class Base {
  n: number;
  constructor(n: number) {
    this.n = n;
    console.log("base", n);
  }
}
class R extends Base {
  f = (console.log("R field"), 1);
  constructor(c: number) {
    if (c === 0) {
      return;
    }
    super(c);
    console.log("after super", this.f);
  }
}
new R(2);
try { new R(0); } catch (e) { console.log((e as Error).constructor.name, (e as Error).message); }
