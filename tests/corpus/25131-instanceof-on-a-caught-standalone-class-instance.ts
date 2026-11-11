// `e instanceof K` on a catch binding, where K is a class with no base and no subclasses (so no vtable word). It was refused (SC1090); the
// answer must be Node's: true for a K, false for any other thrown value, and the narrowed binding reads K's members.
class Failure {
  code: number;
  constructor(code: number) { this.code = code; }
  describe(): string { return "failure " + this.code; }
}
class Warning {
  text = "careful";
}
class Parent {}
class Child extends Parent {}

function thrower(i: number): void {
  if (i === 0) throw new Failure(7);
  if (i === 1) throw new Warning();
  if (i === 2) throw new Child();
  if (i === 3) throw new Parent();
  if (i === 4) throw new Error("plain");
  if (i === 5) throw "string";
  if (i === 6) throw 42;
  if (i === 7) throw { code: 7 };
  if (i === 8) throw [1, 2];
  if (i === 9) throw null;
}
for (let i = 0; i < 10; i++) {
  try {
    thrower(i);
  } catch (e) {
    console.log(i, e instanceof Failure, e instanceof Warning, e instanceof Parent, e instanceof Child, e instanceof Error);
    if (e instanceof Failure) console.log("  failure", e.code, e.describe());
    else if (e instanceof Warning) console.log("  warning", e.text);
    else console.log("  other", String(e));
  }
}

async function failAsync(): Promise<void> { throw new Failure(9); }
async function main(): Promise<void> {
  try { await failAsync(); } catch (e) { console.log("await", e instanceof Failure, e instanceof Warning, e instanceof Failure ? e.code : -1); }
  await failAsync().catch((e) => console.log("catch cb", e instanceof Failure, e instanceof Warning));
  try {
    try { thrower(0); } catch (inner) { console.log("inner", inner instanceof Failure); throw inner; }
  } catch (outer) {
    console.log("rethrown", outer instanceof Failure, outer instanceof Warning);
  }
}
main().then(() => console.log("done"));
