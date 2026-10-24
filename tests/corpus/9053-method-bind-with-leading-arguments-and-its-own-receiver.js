"use strict";
// this.m.bind(this, a, b): the receiver-bound method with leading arguments fixed (mysql2's
// pool retry: process.nextTick(this.getConnection.bind(this, cb))).
class Pool {
  constructor() { this.n = 0; this.log = []; }
  getConnection(cb) { this.n++; this.log.push("get" + this.n); cb(null, "conn" + this.n); }
  add(a, b, c) { this.log.push("add" + (a + b + c + this.n)); return a + b + c + this.n; }
  later(cb) {
    if (this.n < 2) process.nextTick(this.getConnection.bind(this, cb));
  }
  partials() {
    const one = this.add.bind(this, 1);
    const two = this.add.bind(this, 1, 2);
    const three = this.add.bind(this, 1, 2, 3);
    return [one(10, 100), two(10), three(), this.add.bind(this, 1) === this.add.bind(this, 1)];
  }
}
const p = new Pool();
p.later((err, c) => {
  console.log("got", err, c, p.log.join());
  p.later((e2, c2) => console.log("again", e2, c2, p.log.join()));
});
p.getConnection((err, c) => console.log("first", c));
console.log(p.partials(), p.log.join());
