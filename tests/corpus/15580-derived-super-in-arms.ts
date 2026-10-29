class Base {
  tag: string;
  constructor(tag: string, n: number) {
    this.tag = tag + n;
    console.log("base", tag, n);
  }
}
class D extends Base {
  f = (console.log("field init"), 7);
  constructor(c: number) {
    if (c === 0) {
      super("zero", 0);
    } else if (c === 1) {
      super("one", 1);
    } else {
      super("other", c);
    }
    console.log("after", this.tag, this.f);
  }
}
new D(0);
new D(1);
new D(5);
