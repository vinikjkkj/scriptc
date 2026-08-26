// A settler field READ before the write that declares it. The read is
// earlier in the constructor than the `new Promise`, so in Node the
// property does not exist yet and the read answers `undefined` -- the
// zeroed-memory trap a plain static slot would answer 0/NULL for.
//
// Also the two-fields-one-executor case, and an executor that THROWS after
// assigning the first of them: `new Promise` turns the throw into a
// rejection, the constructor keeps going, and the second field is never
// written.
class Deferred {
  constructor() {
    console.log("before:", typeof this.resolve, String(this.resolve));
    this.promise = new Promise((resolve) => {
      this.resolve = resolve;
    });
    console.log("after:", typeof this.resolve);
  }
}

class Half {
  constructor(boom) {
    this.promise = new Promise((resolve, reject) => {
      this.a = resolve;
      if (boom) throw new Error("executor boom");
      this.b = reject;
    });
  }
}

class Gate {
  constructor() {
    this.promise = new Promise((resolve) => {
      this.resolve = resolve;
    });
    this.settled = false;
  }
  probe() {
    return typeof this.resolve;
  }
  open(v) {
    this.settled = true;
    this.resolve(v);
  }
}

async function main() {
  const d = new Deferred();
  d.resolve(7);
  console.log(await d.promise);

  const ok = new Half(false);
  console.log("ok a:", typeof ok.a, "b:", typeof ok.b);
  ok.a(1);
  console.log("ok settle:", await ok.promise);

  const bad = new Half(true);
  console.log("bad a:", typeof bad.a, "b:", typeof bad.b, "b" in bad);
  try {
    await bad.promise;
    console.log("no throw");
  } catch (e) {
    console.log("caught:", e.message);
  }

  const g = new Gate();
  console.log("pre:", g.probe(), g.settled);
  g.open(3);
  console.log("post:", g.probe(), g.settled);
  console.log("value:", await g.promise);
}

void main();
