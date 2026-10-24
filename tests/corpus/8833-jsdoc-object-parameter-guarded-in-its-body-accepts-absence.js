"use strict";
// JavaScript never checks a JSDoc annotation: a parameter documented as an object that the body
// guards (`holder && holder.stack`) is called with undefined and null (mysql2's applyCapturedStack
// gets undefined on every query with tracing off). The guard must be reached, not a TypeError
// raised while the arguments cross.
/** @param {{ stack?: string }} holder */
function use(holder) {
  const stack = holder && holder.stack;
  return typeof stack === "string" ? stack : "none";
}
/** @param {{ n: number }} o */
function count(o) {
  if (!o) return -1;
  return o.n;
}
/** @param {{ n: number }} o */
function dflt(o) {
  return (o || { n: 7 }).n;
}
/** @param {{ n: number }} o */
function optional(o) {
  return o?.n;
}
/** @param {{ n: number }} o */
function nullTest(o) {
  return o == null ? "absent" : "present " + o.n;
}
/** @param {{ n: number }} o */
function unguarded(o) {
  return o.n + 1;
}
function viaUntyped(h) { return use(h); }
function mk(flag) { return flag ? { stack: "yes" } : undefined; }
console.log(viaUntyped(mk(true)), viaUntyped(mk(false)), viaUntyped(undefined), viaUntyped(null), use({}), use({ stack: "x" }));
function pass(v) { return [count(v), dflt(v), optional(v), nullTest(v)]; }
console.log(pass({ n: 3 }), pass(undefined), pass(null));
console.log(unguarded({ n: 1 }));
try {
  console.log(unguarded(undefined));
} catch (e) {
  console.log(e.name);
}
