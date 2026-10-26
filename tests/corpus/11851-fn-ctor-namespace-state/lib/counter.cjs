"use strict"
// A function constructor whose prototype methods read and write `this` state, and
// whose constructor takes an optional initial value.
function Counter (start) {
  this.n = start === undefined ? 0 : start
  this.log = []
}

Counter.prototype.add = function (k) {
  this.n += k
  this.log.push("+" + k)
  return this
}

Counter.prototype.reset = function () {
  var old = this.n
  this.n = 0
  return old
}

Counter.prototype.describe = function () {
  return "Counter(" + this.n + ") [" + this.log.join(" ") + "]"
}

exports.Counter = Counter
