// Object.freeze of a binding that holds a FRESH array (`const fields = xs.map(...)`; ioredis HimportCoordinator.cloneHimportFieldsets): the method call allocated the
// array and nothing else holds it when the freeze runs, so the freeze is as unobservable as over a literal. The receiver is an array the checker types
// `any` here (a property of an untyped parameter) but an earlier `!Array.isArray` guard proves it.
"use strict";
function copyValue(value) { return value instanceof Buffer ? Buffer.from(value) : value; }
function clone(fieldsets) {
  if (fieldsets === undefined) return undefined;
  if (!Array.isArray(fieldsets)) throw new TypeError("himportFieldsets must be an array");
  const names = new Set();
  const copied = fieldsets.map((fieldset) => {
    if (!fieldset || typeof fieldset !== "object") throw new TypeError("Each fieldset must be an object");
    if (!Array.isArray(fieldset.fields)) throw new TypeError("fields must be an array");
    const name = copyValue(fieldset.name);
    if (names.has(name)) throw new TypeError("Duplicate");
    names.add(name);
    const fields = fieldset.fields.map((field) => {
      if (typeof field !== "string" && !Buffer.isBuffer(field)) throw new TypeError("bad field");
      return copyValue(field);
    });
    return Object.freeze({ name, fields: Object.freeze(fields) });
  });
  return Object.freeze(copied);
}
const out = clone([{ name: "a", fields: ["x", "y"] }, { name: "b", fields: ["z"] }]);
console.log(out.length, out[0].name, out[0].fields.join("|"), out[1].fields.length);
try { clone([{ name: "a", fields: ["q"] }, { name: "a", fields: ["r"] }]); } catch (e) { console.log(e.message); }
console.log(clone(undefined));
/** @param {string[]} list */
function upper(list) {
  const up = list.map((s) => s.toUpperCase());
  const first = list.slice(0, 1);
  return [Object.freeze(up), Object.freeze(first)];
}
const [u, f] = upper(["a", "b"]);
console.log(u.join(), f.join(), u.length);
