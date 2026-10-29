// Arrays nested under an options depth: [Array] past the limit, full below it.
import { formatWithOptions } from "node:util";

const grid = [[1, [2, [3, [4]]]], ["x", ["y"]]];
console.log(formatWithOptions({ depth: 0 }, "%O", grid));
console.log(formatWithOptions({ depth: 1 }, "%O", grid));
console.log(formatWithOptions({ depth: 3 }, "%O", grid));
console.log(formatWithOptions({ depth: 1 }, "%s", grid));
