class Base {
  tag: string;
  constructor(t: string) {
    this.tag = t;
    console.log("base", t);
  }
}
class W extends Base {
  constructor(c: boolean) {
    if (c) {
      super("yes");
    }
    // @ts-ignore
    this.tag = "w";
    // @ts-ignore
    console.log("after write", this.tag);
  }
}
new W(true);
try { new W(false); } catch (e) { console.log((e as Error).constructor.name, (e as Error).message); }
