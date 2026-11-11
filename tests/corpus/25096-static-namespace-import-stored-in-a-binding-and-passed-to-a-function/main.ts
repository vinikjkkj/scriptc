// The module namespace OBJECT of a static `import * as` is a first-class value: it can be stored in a binding, passed to a function,
// inspected, and member accesses through the copy see the same exports.
import * as lib from "./lib.ts";

console.log(lib.one());
const grabbed = lib;
console.log(grabbed.one());
function use(ns: typeof lib): number {
  return ns.one() + 1;
}
console.log(use(lib), use(grabbed));
console.log(Object.keys(grabbed).join(","));
console.log(grabbed);
