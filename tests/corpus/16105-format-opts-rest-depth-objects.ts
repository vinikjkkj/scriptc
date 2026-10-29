// Rest arguments of several kinds share one depth from the options.
import { formatWithOptions } from "node:util";

const inner = { k: { m: { n: "deep" } } };
console.log(formatWithOptions({ depth: 0 }, 1, "two", true, null, undefined, inner));
console.log(formatWithOptions({ depth: 2 }, 1, "two", true, null, undefined, inner));
console.log(formatWithOptions({ depth: 3 }, inner, [inner]));
