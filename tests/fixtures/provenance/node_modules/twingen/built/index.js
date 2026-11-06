"use strict";
function Ring() {
  this._items = [];
  this._head = 0;
  this._label = "ring";
  this._cap = 0;
}
Ring.prototype.push = function push(item) {
  this._items.push(item);
  return this.length;
};
Ring.prototype.shift = function shift() {
  if (this._head >= this._items.length) return undefined;
  return this._items[this._head++];
};
Ring.prototype.peek = function peek() {
  return this._items[this._head];
};
Ring.prototype.size = function size() {
  return this._items.length - this._head;
};
Object.defineProperty(Ring.prototype, "length", {
  get: function length() {
    return this.size();
  },
});
// Accessor forms: a method-shorthand getter, a get+set pair of function expressions, and a setter-only shorthand.
Object.defineProperty(Ring.prototype, "first", {
  get() {
    return this._items[this._head];
  },
  configurable: true,
});
Object.defineProperty(Ring.prototype, "label", {
  get: function () {
    return this._label;
  },
  set: function (v) {
    this._label = "<" + v + ">";
  },
});
Object.defineProperty(Ring.prototype, "cap", {
  set(v) {
    this._cap = v * 2;
  },
});
Ring.prototype.capacity = function capacity() {
  return this._cap;
};
module.exports = Ring;
