// %c consumes its argument and prints nothing; %% prints a percent sign.
import { formatWithOptions } from "node:util";

const o = { a: { b: { c: 1 } } };
console.log(formatWithOptions({ depth: 0 }, "100%% done %c styled %O", "color: red", o));
console.log(formatWithOptions({ depth: 1 }, "%c%c%%", "x", o, "tail"));
console.log(formatWithOptions({ depth: 2 }, "%%s %%O", o));
