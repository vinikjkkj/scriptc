const counter = {
  n: 0,
  step: 2,
  inc() { this.n += this.step; return this; },
  twice() { this.inc().inc(); return this.n; },
  later(cb) { [1, 2].forEach((k) => { this.n += k; }); cb(this.n); },
  label: function () { return "n=" + this.n; },
  describe() { const f = () => this.label() + "/" + this.step; return f(); },
};
console.log(counter.inc().n, counter.twice(), counter.label(), counter.describe());
counter.later((v) => console.log("later", v));
counter.step = 10; counter.inc();
console.log(counter.n, JSON.stringify(counter), Object.keys(counter).join(","));

function make(start) {
  const acc = {
    total: start,
    add(x) { this.total += x; return this; },
    get() { return this.total; },
  };
  return acc.add(1).add(2).get();
}
console.log(make(10), make(0));

const stack = {
  items: [],
  push(x) { this.items.push(x); return this.items.length; },
  peek() { return this.items[this.items.length - 1]; },
  size() { return this.items.length; },
};
stack.push("a"); stack.push("b");
console.log(stack.peek(), stack.size(), stack.items);

const outer = {
  tag: "outer",
  run() { const inner = { tag: "inner", who() { return this.tag; } }; return this.tag + ":" + inner.who(); },
};
console.log(outer.run());
const detached = { v: 1, get() { return this === undefined ? "undef" : this.v; } };
console.log(detached.get());
