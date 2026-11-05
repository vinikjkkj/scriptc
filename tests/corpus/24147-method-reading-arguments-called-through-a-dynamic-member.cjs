// A method that reads `arguments` called through an untyped receiver (mysql2's ring queue: push(item) checks arguments.length):
// the member call packs every argument for it, so the item arrives and the queue keeps it.
class Cmd { constructor(n) { this.n = n; } }
class Q {
  constructor() { this._list = new Array(4); this._mask = 3; this._head = 0; this._tail = 0; }
  get length() { return (this._tail - this._head) & this._mask; }
  push(item) {
    if (arguments.length === 0) return this.length;
    this._list[this._tail] = item; this._tail = (this._tail + 1) & this._mask;
    return this.length;
  }
  shift() {
    const head = this._head;
    if (head === this._tail) return undefined;
    const item = this._list[head];
    this._list[head] = undefined;
    this._head = (head + 1) & this._mask;
    return item;
  }
}
class Conn { constructor() { this.q = new Q(); } add(c) { this.q.push(c); } }
const cn = new Conn();
cn.add(new Cmd(7));
function viaDyn(conn, x) { return conn.q.push(x); }
console.log(viaDyn(cn, new Cmd(9)));
const a = cn.q.shift();
console.log(a && a.n, cn.q.length);
const b = cn.q.shift();
console.log(b && b.n);
class Counter {
  constructor() { this.seen = []; }
  note() { for (let i = 0; i < arguments.length; i++) this.seen.push(arguments[i]); return arguments.length; }
}
class Holder { constructor() { this.c = new Counter(); } direct(a) { return this.c.note(a); } }
const h = new Holder();
h.direct("x");
function viaDyn2(o, ...xs) { return o.c.note(...xs); }
console.log(viaDyn2(h), viaDyn2(h, 1), viaDyn2(h, "a", "b"), h.c.seen.join("|"));
