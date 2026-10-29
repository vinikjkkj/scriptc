"use strict";
function isObject(value) {
  return (typeof value === "object" && value !== null) || typeof value === "function";
}
function hasOwn(o, k) {
  return Object.prototype.hasOwnProperty.call(o, k);
}
module.exports = exports = {
  isObject,
  hasOwn,
};
