"use strict";
// The strict-mode twin: a write to a read-only symbol property, a delete of a non-configurable one and a property creation on a primitive throw V8's TypeErrors.
const k = Symbol("k");
const fixed = Symbol("fixed");
const open = JSON.parse("{}");
open[k] = 1;
Object.defineProperty(open, fixed, { value: 42, enumerable: true });
for (const f of [
  () => { open[fixed] = 1; },
  () => delete open[fixed],
  () => { JSON.parse("5")[k] = 1; },
  () => { JSON.parse("null")[k]; },
  () => { JSON.parse("null")[k] = 1; },
  () => k in JSON.parse("3"),
  () => Object.defineProperty(open, fixed, { value: 7 }),
]) {
  try { f(); console.log("no throw"); } catch (e) { console.log(e.constructor.name + ": " + e.message); }
}
console.log(open[k], open[fixed], Object.getOwnPropertySymbols(open).length);
console.log(Object.defineProperty(open, fixed, { value: 42 }) === open);
