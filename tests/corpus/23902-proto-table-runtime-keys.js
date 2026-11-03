"use strict";
// Keys built at run time (concatenation, a number, a template), reads before the write, an own-field name left alone.
class Table {
  constructor() {
    this.size = 3;
  }
  who() {
    return "table" + this.size;
  }
}
const before = Table.prototype.a1;
const names = ["a1", 2, `t${3}`];
names.forEach(function (n, i) {
  Table.prototype[n] = function () {
    return "m" + i + ":" + this.who();
  };
});
const t = new Table();
console.log(before, typeof t.a1, t.a1(), t["2"] === undefined);
console.log(t.a1(), Table.prototype[2] === Table.prototype["2"], Table.prototype.t3.call(t));
console.log(Table.prototype.a1 === t.a1, Table.prototype.zzz);
const other = new Table();
other.size = 9;
console.log(other.a1(), t.a1());
