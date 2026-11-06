// denque 2.1.0 verbatim (the double-ended queue ioredis keeps its command queues in), declared by its own generic
// `index.d.ts` (`declare class Denque<T = any>`, `export = Denque`) and defined by an ES5 function constructor whose
// prototype carries 20+ methods, a getter-only `length` defined through Object.defineProperty, fields assigned only in
// one constructor branch, and methods that read `arguments`. The queues sit in fields a method assigns (so each reads
// `Denque | undefined`), exactly as ioredis' Redis class holds them.
const Denque = require("twinden");

class Holder {
  constructor() {
    this.n = 0;
  }
  reset() {
    this.offline = new Denque();
    this.commands = new Denque([10, 20, 30]);
  }
  push(x) {
    this.offline.push(x);
    this.n++;
  }
  drain() {
    const out = [];
    let item;
    while ((item = this.offline.shift())) out.push(item);
    return out;
  }
  info() {
    return this.offline.length + "/" + this.commands.length;
  }
}

const h = new Holder();
h.reset();
h.push("a");
h.push("b");
h.push("c");
console.log(h.n, h.info(), h.offline.peekFront(), h.offline.peekBack());
console.log(h.drain().join(","), h.info(), h.offline.isEmpty());
const q = h.commands;
q.unshift(5);
q.push(40);
console.log(q.toArray().join(","), q.pop(), q.shift(), q.length);
console.log(q.splice(1, 1).join(","), q.toArray().join(","), q.get(0), q.peekAt(1));
q.clear();
console.log(q.length, q.shift(), q.isEmpty());
const big = new Denque();
for (let i = 0; i < 50; i++) big.push(i);
for (let i = 0; i < 20; i++) big.shift();
console.log(big.length, big.peekFront(), big.peekBack(), big.toArray().length);
