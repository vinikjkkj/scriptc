'use strict';
// ===/!== between an untyped (any) value and a union of scalar arms
// (string | boolean, number | undefined), the shape a cache key keeps for
// per-option flags: the dyn side answers by value, arm for arm.
function keyOf(flag) { return flag === 'raw' ? 'raw' : (flag === 'on' ? true : false); }
class Entry {
  constructor(nest, count) {
    this.nest = keyOf(nest);
    this.count = count;
  }
  matches(nest, count) {
    if (this.nest !== keyOf(nest) || this.count !== count) return false;
    return true;
  }
}
const e = new Entry('on', 2);
console.log(e.matches('on', 2), e.matches('raw', 2), e.matches('off', 2), e.matches('on', 3));
function pick(x, y) { return x === y; }
function miss(x, y) { return x !== y; }
const u = Math.random() < 2 ? 'text' : true;
console.log(pick(u, 'text'), pick(u, true), miss(u, 'other'), pick(undefined, undefined));
console.log(pick(7, 7), pick(7, '7'), miss(0, -0), pick(null, undefined));
