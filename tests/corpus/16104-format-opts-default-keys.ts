// Every options key at its default value is accepted and renders as util.format does.
import { formatWithOptions } from "node:util";

const o = { a: { b: { c: { d: 1 } } }, s: "x", list: [1, 2, 3] };
console.log(formatWithOptions({
  colors: false,
  compact: 3,
  breakLength: 80,
  showHidden: false,
  sorted: false,
  numericSeparator: false,
  maxArrayLength: 100,
  maxStringLength: 10000,
}, "%O", o));
console.log(formatWithOptions({ colors: false, compact: 3, breakLength: 80, sorted: false }, "%s %d", "v", 8, o));
console.log(formatWithOptions({ colors: false, compact: 3, breakLength: 80 }, "%O", o));
