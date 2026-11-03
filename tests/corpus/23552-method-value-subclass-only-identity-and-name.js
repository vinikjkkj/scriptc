// Identity per (class, method): two reads in one class agree, equal the declarer's prototype function, differ between
// declarers, and are named and measured like the method (`name`, `length`).
class Base {
  constructor() {
    this.tag = 'base';
    this.held = null;
  }
  twice() {
    return this.step === this.step;
  }
  kind() {
    return typeof this.step;
  }
  hold() {
    this.held = this.step;
    return this.held === this.step;
  }
}
class Left extends Base {
  constructor() {
    super();
    this.tag = 'left';
  }
  step(x, y) {
    return this.tag + ':' + x + ':' + y;
  }
}
class LeftChild extends Left {
  constructor() {
    super();
    this.tag = 'leftchild';
  }
}
class Right extends Base {
  constructor() {
    super();
    this.tag = 'right';
  }
  step(x) {
    return this.tag + '/' + x;
  }
}
const l = new Left();
const lc = new LeftChild();
const r = new Right();
console.log(l.twice(), lc.twice(), r.twice(), l.kind(), lc.kind(), r.kind());
console.log(l.hold(), lc.hold(), r.hold());
console.log(l.held === lc.held, l.held === r.held, l.held === Left.prototype.step, lc.held === Left.prototype.step, r.held === Right.prototype.step);
console.log(l.held.name, r.held.name, l.held.length, r.held.length);
console.log(l.held('a', 'b'), lc.held('c', 'd'), r.held('e'));
