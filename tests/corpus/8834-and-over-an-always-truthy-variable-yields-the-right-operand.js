"use strict";
// `obj && obj.field` where obj is a record, class instance, array or function variable: the left
// operand is always truthy, so the value is the right operand. The result type tsc computes is the
// right operand's, which has no home for the left (it used to be coerced into it first and trapped).
/** @param {{ stack?: string }} holder */
function a(holder) {
  const stack = holder && holder.stack;
  return typeof stack === "string" ? stack : "none";
}
class Box {
  constructor(v) { this.v = v; }
}
function b(box) { return typeof box === "object" ? box && box.v : "x"; }
const arr = [1, 2, 3];
const fn = function () { return 5; };
const rec = { a: 1, b: "two" };
console.log(a({ stack: "x" }), a({}));
console.log(rec && rec.b, rec && rec.a, arr && arr.length, fn && fn());
const bx = new Box("boxed");
console.log(bx && bx.v, b(bx));
const missing = rec.zz;
console.log(rec && missing, (rec || missing) === rec, arr || 0);
