// A prototype write replaces a declared method for every instance, old and new.
class Pipe {
  constructor() { this.n = 0; }
  add(x) { this.n += x; return this; }
  get() { return this.n; }
}
const before = new Pipe();
Pipe.prototype.add = function (x) { this.n += 2 * x; return this; };
console.log(before.add(3).get(), new Pipe().add(4).get());
