"use strict";
function Ring() {
  this._items = [];
  this._head = 0;
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
module.exports = Ring;
