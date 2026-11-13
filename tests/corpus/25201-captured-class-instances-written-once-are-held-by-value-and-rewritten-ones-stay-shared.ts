// A class instance captured by a closure and never rewritten after its declaration is held by value; one rewritten after capture stays shared.
// `this` in arrow functions, per-iteration bindings, rings through a held instance, async methods and nested forwarding are all covered; the san
// lanes run the RC audit over every one of them.
class Holder {
  name: string;
  tags: string[];
  constructor(n: string) {
    this.name = n;
    this.tags = [n, n + "x"];
  }
  tagger(): () => string {
    return () => this.name + "/" + this.tags.length;
  }
  viaSelf(): () => () => string {
    const self = this;
    return () => () => self.name + "!" + self.tags.length;
  }
  lateWrite(): () => number {
    const me = this;
    let k = 1;
    const f = () => me.tags.length + k;
    k = 5;
    return f;
  }
  async slow(extra: string): Promise<string> {
    const keep = this;
    await Promise.resolve();
    const r = () => keep.name + extra;
    await Promise.resolve();
    return r();
  }
}

class Node2 {
  next: Node2 | null = null;
  val: number;
  cb: (() => number) | null = null;
  constructor(v: number) {
    this.val = v;
  }
}

function chain(n: number): Node2 {
  const head = new Node2(0);
  const fn = (): number => head.val + 1; // head -> fn -> head: a ring through a held instance
  head.cb = fn;
  let cur = head;
  for (let i = 1; i < n; i++) {
    const nx = new Node2(i);
    cur.next = nx;
    const f2 = (): number => nx.val * 2;
    nx.cb = f2;
    cur = nx;
  }
  return head;
}

// rewritten after capture: the closure must see the new instance
function rewritten(): [string, string] {
  let h = new Holder("first");
  const get = (): string => h.name;
  const before = get();
  h = new Holder("second");
  return [before, get()];
}

// a parameter instance captured by value, another one reassigned before and after the capture
function params(a: Holder, b: Holder, c: Holder): string {
  b = new Holder(b.name + "'");
  const f = (): string => a.name + b.name + c.name;
  c = new Holder("late");
  return f();
}

function perIteration(): string[] {
  const fs: (() => string)[] = [];
  for (let i = 0; i < 5; i++) {
    const hh = new Holder("h" + i);
    fs.push(() => hh.name + i);
  }
  for (const hh of [new Holder("x"), new Holder("y")]) fs.push(() => hh.name);
  return fs.map((f) => f());
}

async function main(): Promise<void> {
  const h = new Holder("abc");
  console.log(h.tagger()(), h.viaSelf()()(), h.lateWrite()());
  let tot = 0;
  for (let r = 0; r < 50; r++) {
    let n: Node2 | null = chain(20);
    while (n !== null) {
      tot += n.cb!();
      n = n.next;
    }
  }
  console.log(tot);
  console.log(JSON.stringify(rewritten()));
  console.log(params(new Holder("A"), new Holder("B"), new Holder("C")));
  console.log(perIteration().join(","));
  console.log(await h.slow("-done"));
  const many = await Promise.all([new Holder("p"), new Holder("q")].map((x) => x.slow("?")));
  console.log(many.join(","));
}

main();
