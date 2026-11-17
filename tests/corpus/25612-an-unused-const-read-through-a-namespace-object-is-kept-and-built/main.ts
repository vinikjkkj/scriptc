// Nothing names TABLE, but the namespace object can reach every export through a computed key: the binding counts as read and is built.
import * as lib from "./lib.ts";
const names = ["TABLE", "OTHER"];
for (const n of names) console.log(n, JSON.stringify((lib as unknown as Record<string, unknown>)[n]));
console.log(Object.keys(lib).join(","));
