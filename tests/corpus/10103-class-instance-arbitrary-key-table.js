// Literal-key reads on a class instance: an own field, an inherited field, an inherited method, a missing name, and the method called with an explicit receiver.
class Base {
  constructor() { this.tag = 'base'; this.count = 2; this.flag = true; }
  describe() { return 'base:' + this.tag; }
}
class Leaf extends Base {
  constructor() { super(); this.extra = 'leaf'; }
  describe() { return 'leaf:' + this.extra; }
}
const leaf = new Leaf();
console.log(leaf['tag'], leaf['count'], leaf['flag'], leaf['extra'], typeof leaf['describe'], leaf['nothing'] === undefined);
const fn = leaf['describe'];
console.log(fn.call(leaf));
console.log(fn.apply(leaf, []));
