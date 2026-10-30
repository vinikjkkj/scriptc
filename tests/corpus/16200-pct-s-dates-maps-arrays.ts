// util.format's %s over the shapes that inspect in Node: a Date (built-in
// toPrimitive, inspect), an array of user-toString objects (depth 0 prints
// [Object]), a Map and an array. The %s fence must not refuse any of them.
import { format } from "node:util";

console.log(format("%s", new Date(0)));
console.log(format("%s", [1, 2]));
console.log(format("%s", [{ toString() { return "EL"; } }]));
console.log(format("%s", new Map([["a", 1]])));
console.log("%s", new Date(0));
console.log("%s|%s", -0, 7);
