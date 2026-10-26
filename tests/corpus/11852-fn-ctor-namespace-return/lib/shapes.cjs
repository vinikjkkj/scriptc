"use strict"
// A constructor that returns nothing (the instance is `this`) and one that returns
// an object (that object replaces the instance).
function Plain (x) {
  this.x = x
}

Plain.prototype.twice = function () {
  return this.x * 2
}

function Replaced (x) {
  if (x === undefined) return { fallback: true }
  this.x = x
}

Replaced.prototype.twice = function () {
  return this.x * 2
}

exports.Plain = Plain
exports.Replaced = Replaced
