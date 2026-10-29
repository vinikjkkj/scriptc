class Base {
  x: number;
  constructor(x: number) {
    this.x = x;
  }
}
function note(s: string, v: number): number { console.log("arg", s, v); return v; }
class K extends Base {
  z = note("field", 9);
  constructor(a: number, b: string) {
    if (a > 0) {
      if (b === "p") {
        super(note("p", a));
      } else {
        super(note("q", a * 2));
      }
    } else {
      super(note("none", 0));
    }
    console.log("ctor body", this.x, this.z);
  }
}
new K(1, "p");
new K(1, "q");
new K(0, "p");
