class MyErr extends Error {
  code2: number;
  constructor(kind: number, msg: string) {
    if (kind === 0) {
      super("zero: " + msg);
    } else {
      super("other: " + msg);
    }
    this.code2 = kind;
    this.name = "MyErr";
  }
}
const a = new MyErr(0, "a");
const b = new MyErr(3, "b");
console.log(a.message, a.code2, a.name, a instanceof MyErr, a instanceof Error);
console.log(b.message, b.code2, b.name);
