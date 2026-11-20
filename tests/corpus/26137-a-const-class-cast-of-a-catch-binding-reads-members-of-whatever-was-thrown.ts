class MyErr extends Error {
  code = 5;
  tags: string[] = ["a"];
  constructor(m: string) {
    super(m);
  }
}
// `const x = e as C` is erased in Node too: a member read answers whatever the thrown value has.
try {
  throw "str";
} catch (e) {
  const x = e as MyErr;
  console.log(x.code, x.message, x.tags);
}
try {
  throw 42;
} catch (e) {
  const x = e as MyErr;
  console.log(x.code, x.name);
}
try {
  throw "s";
} catch (e) {
  const x = e as MyErr;
  console.log(x.code === 5, x.tags?.length);
}
try {
  throw new Error("plain");
} catch (e) {
  const x = e as MyErr;
  if (x.code === 5) console.log("five");
  else console.log(x.message);
}
try {
  throw new MyErr("mine");
} catch (e) {
  const x = e as MyErr;
  const n: number = x.code + 1;
  console.log(n, x.tags.length, x.message.toUpperCase(), x instanceof MyErr);
}
