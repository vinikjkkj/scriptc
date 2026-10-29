class Base {
  tag: string;
  constructor(tag: string) {
    this.tag = tag;
    console.log("base", tag);
  }
  hello(): string { return "hi " + this.tag; }
}
class H extends Base {
  constructor(c: boolean) {
    if (c) {
      super("yes");
    }
    // @ts-ignore
    console.log("mid", this.hello());
    // @ts-ignore
    this.tag = this.tag + "!";
    // @ts-ignore
    console.log("end", this.tag);
  }
}
new H(true);
try { new H(false); } catch (e) { console.log((e as Error).constructor.name, (e as Error).message); }
