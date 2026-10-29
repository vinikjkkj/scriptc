// console.log's rest-argument rendering and formatWithOptions({}) agree on the same values.
import { formatWithOptions, format } from "node:util";

const v = { a: { b: { c: { d: [1, 2] } } }, s: "t" };
console.log(formatWithOptions({}, "%O", v) === format("%O", v));
console.log(formatWithOptions({ depth: 2 }, "rest", v) === format("rest", v));
console.log(formatWithOptions({ depth: 2 }, "%O", v));
