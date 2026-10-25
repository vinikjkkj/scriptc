// Computed reads of class PROTOTYPE members by literal key: typeof of a method, a missing name, and an inherited method.
class Base {
  n = 3;
  close() { return 'close:' + this.n; }
  escape(s) { return 'esc(' + s + ')'; }
  other() { return 9; }
}
class Leaf extends Base {}
console.log(typeof Base.prototype['close'], typeof Base.prototype['escape'], typeof Base.prototype['missing'], typeof Base.prototype['other']);
console.log(typeof Leaf.prototype['close'], typeof Leaf.prototype['nothing']);
const fn = Base.prototype['escape'];
console.log(typeof fn);
