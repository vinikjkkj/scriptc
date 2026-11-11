// A thrown instance of a class that has a base or subclasses (so it carries a vtable) but is not an Error: String(e), a template span and
// `e + ""` printed "[object Object]" where Node runs the class's own toString / valueOf (inherited ones included).
class Shape { toString(): string { return "shape"; } }
class Circle extends Shape { }
class Square extends Shape { toString(): string { return "square"; } }
class Weight { valueOf(): number { return 9; } }
class Heavy extends Weight { }
class Blank { }
class Blanker extends Blank { }

function thrower(i: number): void {
  if (i === 0) throw new Shape();
  if (i === 1) throw new Circle();
  if (i === 2) throw new Square();
  if (i === 3) throw new Heavy();
  if (i === 4) throw new Blank();
  if (i === 5) throw new Blanker();
}
for (let i = 0; i < 6; i++) {
  try {
    thrower(i);
  } catch (e) {
    console.log(i, String(e), `${e}`, e + "", "<" + e + ">", e instanceof Shape, e instanceof Square, e instanceof Weight);
  }
}

function fail(i: number): Promise<void> {
  return i === 0 ? Promise.reject(new Square()) : Promise.reject(new Circle());
}
async function main(): Promise<void> {
  for (let i = 0; i < 2; i++) {
    try { await fail(i); } catch (e) { console.log("await", i, String(e), `${e}`, e instanceof Shape); }
  }
  await fail(0).catch((e) => console.log("catch cb", String(e), `${e}`));
}
main().then(() => console.log("done"));
