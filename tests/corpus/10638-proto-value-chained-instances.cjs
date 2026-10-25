// An instance stored into a field of another instance; the nested read goes through the second instance.
class Outer {
  /** @param {Inner} inner */
  constructor(inner) { this.inner = inner; }
}
class Inner {
  constructor(n) { this.n = n; }
  setTag() { this.tag = 'in-set'; }
}
Inner.prototype.tag = 'in-none';
const i1 = new Inner(1);
const o = new Outer(i1);
const inner0 = o.inner;
console.log(inner0.tag);
const inner = o.inner;
inner.setTag();
console.log(inner.tag, i1.tag);
