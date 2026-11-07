// The executor shape under an async arrow on a fiber: a subclass instance (a base-class method read through `this`), an async
// overloaded method, a method that stores `this` into a timer callback, and two views of one instance.
class Base {
  tag = "base";
  describe(): string {
    return this.tag;
  }
}
class Pool extends Base {
  calls = 0;
  query(text: string): Promise<string>;
  query(text: string, values: unknown[]): Promise<string>;
  query(text: string, values?: unknown[]): Promise<string> {
    this.calls++;
    return Promise.resolve(`${this.describe()}#${this.calls}:${text}:${values === undefined ? "-" : values.length}`);
  }
  later(cb: (tag: string) => void): void {
    setTimeout(() => cb(this.tag), 0);
  }
}
type Executor = { query: any; later: any };
function hold(): unknown {
  const p = new Pool();
  p.tag = "sub";
  return p;
}
const run = async (x: Executor, label: string): Promise<void> => {
  console.log(label, await x.query("a"));
  console.log(label, await x["query"]("b", [1, 2]));
  x.later((tag: string) => console.log(label, "later", tag));
};
const held = hold();
const e1 = held as Executor;
const e2 = held as Executor;
run(e1, "e1")
  .then(() => run(e2, "e2"))
  .then(() => {
    (held as { tag: string }).tag = "after";
  })
  .then(() => run(e1, "e3"))
  .catch((e) => console.log("ERR", (e as Error).message));
