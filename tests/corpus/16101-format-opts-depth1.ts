// formatWithOptions({ depth: 1 }): one nested level is shown, the next is [Object] / [Array].
import { formatWithOptions } from "node:util";

const tree = { a: { b: { c: { d: 1 } } }, arr: [1, [2, [3]]], s: "x" };
console.log(formatWithOptions({ depth: 1 }, "%O", tree));
console.log(formatWithOptions({ depth: 1 }, "rest", tree, [tree]));
console.log(formatWithOptions({ depth: 1 }, "%d %i %s", 7, 8.9, tree));
