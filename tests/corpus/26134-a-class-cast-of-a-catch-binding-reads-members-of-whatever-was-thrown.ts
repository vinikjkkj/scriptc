class MyErr extends Error {
  code = 5;
  tags: string[] = ["a"];
  constructor(m: string) {
    super(m);
  }
  hello(): string {
    return "hi " + this.code;
  }
}
// The cast is erased in Node: a member read answers whatever the thrown value has.
try {
  throw "str";
} catch (e) {
  console.log((e as MyErr).code, (e as MyErr).message, (e as MyErr).tags);
}
try {
  throw 42;
} catch (e) {
  console.log((e as MyErr).code, (e as MyErr).name);
}
try {
  throw new Error("plain");
} catch (e) {
  console.log((e as MyErr).message, (e as MyErr).code);
}
try {
  throw new MyErr("mine");
} catch (e) {
  const n: number = (e as MyErr).code + 1;
  console.log(n, (e as MyErr).tags.length, (e as MyErr).message.toUpperCase(), (e as MyErr).hello());
}
// A call of a member the payload lacks is Node's own TypeError text.
try {
  throw "x";
} catch (e) {
  try {
    (e as MyErr).hello();
  } catch (e2: any) {
    console.log(e2 instanceof TypeError, e2.message);
  }
}
