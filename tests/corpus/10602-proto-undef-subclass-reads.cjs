// A subclass instance reads the base prototype datum, and the subclass's own method writes the shadowing field.
class Base {
  constructor(n) { this.n = n; }
  setMeta(v) { this.meta = 'm' + v; }
}
Base.prototype.meta = undefined;
class Sub extends Base {
  constructor(n) { super(n); this.k = 'sub'; }
}
const s = new Sub(3);
console.log(s.meta, 'meta' in s, s.k, s.n);
s.setMeta(4);
const plain = new Base(5);
console.log(s.meta, plain.meta);
