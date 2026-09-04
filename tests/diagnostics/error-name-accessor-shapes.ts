// Getter shapes the `name` routing does NOT accept — a slot stamped at
// construction is only Node's answer when the getter is a constant.

// A body that computes: Node evaluates it at every read.
class Computed extends Error {
  override get name(): string {
    return 'E' + this.message;
  }
}
console.log(new Computed('x').name);

// A real accessor PAIR: the property is writable and not a constant, so
// the write half would have to reach a setter the layout does not have.
class Pair extends Error {
  private n = 'p';
  override get name(): string {
    return this.n;
  }
  override set name(v: string) {
    this.n = v;
  }
}
console.log(new Pair('y').name);
