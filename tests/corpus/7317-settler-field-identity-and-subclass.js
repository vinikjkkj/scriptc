// The deferred-callback field's VALUE properties, which a slot that merely
// "compiles" can still get wrong: the boxed callback must keep its identity
// across reads, two instances must not share one, it must survive being
// read out of the object and called from another frame, and a SUBCLASS must
// inherit the base's slot and call through it.
class Command {
  constructor(name) {
    this.name = name;
    this.promise = new Promise((resolve, reject) => {
      this.resolve = resolve;
      this.reject = reject;
    });
  }
}

class Base {
  constructor() {
    this.promise = new Promise((resolve) => {
      this.resolve = resolve;
    });
  }
}

class Child extends Base {
  constructor(tag) {
    super();
    this.tag = tag;
  }
  finish(v) {
    this.resolve(v + this.tag.length);
  }
}

function callIt(fn, v) {
  fn(v);
}

async function main() {
  const c = new Command("get");
  console.log("same:", c.resolve === c.resolve);
  const a = c.resolve;
  const b = c.resolve;
  console.log("bound-same:", a === b);
  console.log(c.name, typeof c.promise, typeof c.resolve, typeof c.reject);

  callIt(c.resolve, 5);
  console.log("settled:", await c.promise);

  const d = new Command("set");
  console.log("distinct:", d.resolve === c.resolve);
  d.reject(new Error("boom"));
  try {
    await d.promise;
    console.log("no throw");
  } catch (e) {
    console.log("caught:", e.message);
  }

  const ch = new Child("ab");
  console.log(ch.tag, typeof ch.resolve);
  ch.finish(1);
  console.log(await ch.promise);

  const plain = new Base();
  plain.resolve(99);
  console.log(await plain.promise);
}

void main();
