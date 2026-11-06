// `this` in a static method is the receiver; when nothing but the declaring class can reach the method (no subclass, every use a direct call),
// the receiver IS the class, so reads, writes, calls and arrow functions through `this` are the same as through the class name.
class Flags {
  static table() {
    if (!this.cache) {
      this.cache = { a: 1, b: 2 };
    }
    return this.cache;
  }
  static has(k) {
    return !!this.table()[k];
  }
  static bump() {
    this.count = this.count + 1;
    return this.count;
  }
  static shifted() {
    return [1, 2].map((x) => this.count + x);
  }
  static get twice() {
    return this.count * 2;
  }
}
Flags.count = 0;
console.log(Flags.has("a"), Flags.has("z"), Flags.bump(), Flags.bump(), Flags.shifted().join(","), Flags.twice);
