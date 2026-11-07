"use strict";
// Object.freeze over a FRESH dyn array: strict code throws V8's TypeError on every write path (element, length, property, delete and the in-place methods).
// a frozen FRESH dyn array (the result of `.map` over an untyped, array-guarded parameter): every write path of the dyn array honors the bit
const t = (name, f) => { try { const r = f(); console.log(name, "ok", r === undefined ? "-" : r); } catch (e) { console.log(name, e.constructor.name + ": " + e.message); } };
function mk(list) {
  if (!Array.isArray(list)) throw new TypeError("array expected");
  const copied = list.map((x) => x);
  Object.freeze(copied);
  return copied;
}
const a = mk([1, "two", 3]);
const e = mk([]);
t("setIdx", () => { a[0] = 5; return a.join(); });
t("setBeyond", () => { a[7] = 5; return a.length; });
t("setLen", () => { a.length = 0; return a.length; });
t("delete", () => delete a[0]);
t("prop", () => { a.tag = 1; return a.tag; });
t("push", () => a.push(9)); t("pop", () => a.pop()); t("shift", () => a.shift()); t("unshift", () => a.unshift(1));
t("reverse", () => a.reverse()); t("fill", () => a.fill(0)); t("fillEmpty", () => a.fill(0, 2, 2)); t("copyWithin", () => a.copyWithin(0, 1)); t("splice", () => a.splice(0, 1));
t("spliceIns", () => a.splice(1, 0, 7)); t("sort", () => a.sort());
t("pushE", () => e.push(1)); t("popE", () => e.pop()); t("reverseE", () => e.reverse());
console.log(a.join(), a.length, e.length, a.map((x) => x + "!").join(), a.slice(1).join());
