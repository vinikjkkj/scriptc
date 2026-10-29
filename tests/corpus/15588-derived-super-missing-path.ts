class Base {
  n: number;
  constructor(n: number) {
    this.n = n;
  }
}
class G extends Base {
  constructor(c: boolean) {
    if (c) {
      super(4);
    }
    console.log("end");
  }
}
new G(true);
try { new G(false); } catch (e) { console.log((e as Error).constructor.name, (e as Error).message); }
