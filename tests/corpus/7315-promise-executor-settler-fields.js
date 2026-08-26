// The DEFERRED-CALLBACK FIELD: a class whose constructor assigns
// `this.resolve` / `this.reject` from inside a `new Promise(...)` executor.
// The values ARE the executor's own parameters, which do not exist at the
// top of the constructor -- so the field fence's "assign it unconditionally
// at the top of the constructor" could never be followed here. ioredis's
// built/Command.js:303 is this shape.
//
// The slot is the checked-dynamic box, which already carries undefined as a
// value: a read taken before the write answers `undefined` like Node, and
// the call goes through the dynCall boundary.
class Command {
  constructor(name) {
    this.name = name;
    this.promise = new Promise((resolve, reject) => {
      this.resolve = resolve;
      this.reject = reject;
    });
  }
  ok(v) {
    this.resolve(v);
  }
  fail(e) {
    this.reject(e);
  }
}

// A NESTED arrow inside the executor: the write is two closures from the
// constructor's top level and still runs synchronously.
class Nested {
  constructor() {
    this.promise = new Promise((resolve) => {
      const wire = () => {
        this.resolve = resolve;
      };
      wire();
    });
  }
}

// The write happens on only ONE path through the executor. Node reads
// undefined on the other.
class Maybe {
  constructor(flag) {
    this.promise = new Promise((resolve) => {
      if (flag) this.resolve = resolve;
      else resolve(0);
    });
  }
}

async function main() {
  const c = new Command("get");
  console.log(c.name, typeof c.resolve, typeof c.reject);
  c.ok(41);
  console.log(await c.promise);

  const d = new Command("set");
  d.fail(new Error("nope"));
  try {
    await d.promise;
    console.log("no throw");
  } catch (e) {
    console.log("caught", e.message);
  }

  const n = new Nested();
  console.log(typeof n.resolve);
  n.resolve("deep");
  console.log(await n.promise);

  const a = new Maybe(true);
  console.log("a:", typeof a.resolve);
  a.resolve(9);
  console.log("a value:", await a.promise);

  const b = new Maybe(false);
  console.log("b:", typeof b.resolve, String(b.resolve));
  console.log("b value:", await b.promise);
}

void main();
