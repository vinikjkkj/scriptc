// A large object with depth null breaks across lines the way util.inspect does.
import { formatWithOptions } from "node:util";

const big = {
  alpha: { beta: { gamma: { delta: "one two three four five six seven eight nine ten" } } },
  numbers: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
  flag: true,
  nothing: null,
  text: "a fairly long string value that keeps going past the break length",
};
console.log(formatWithOptions({ depth: null }, "%O", big));
console.log(formatWithOptions({ depth: null, breakLength: 80 }, "%O", big));
