// Literal-union key on an instance, and an arbitrary key naming inherited fields, own fields, methods, and absent names.
class Base {
  constructor() { this.tag = 'base'; this.count = 2; this.flag = true; }
  describe() { return 'base:' + this.tag; }
}
class Leaf extends Base {
  constructor() { super(); this.extra = 'leaf'; }
  describe() { return 'leaf:' + this.extra; }
}
const leaf = new Leaf();
const pick = (k) => leaf[k];
const names = ['tag', 'count', 'flag', 'extra', 'describe', 'nothing'];
for (const n of names) {
  const v = pick(n);
  console.log(n, typeof v, v === undefined ? 'undef' : '');
}
const fn = leaf['describe'];
console.log(fn.call(leaf));
console.log(fn.apply(leaf, []));
const which = Math.random() < 2 ? 'count' : 'tag';
console.log(leaf[which]);
