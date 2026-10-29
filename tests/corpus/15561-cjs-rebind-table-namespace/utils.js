"use strict";
function isObject(value) {
  return (typeof value === "object" && value !== null) || typeof value === "function";
}
function twice(value) {
  return isObject(value) ? 2 : 1;
}
exports = module.exports = {
  isObject: isObject,
  twice: twice,
};
