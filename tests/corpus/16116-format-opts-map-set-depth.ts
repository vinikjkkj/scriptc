// Map and Set values under an options depth.
import { formatWithOptions } from "node:util";

const m = new Map<string, { inner: { v: number } }>([["k", { inner: { v: 1 } }]]);
const s = new Set<number>([1, 2]);
console.log(formatWithOptions({ depth: 0 }, "%O", m));
console.log(formatWithOptions({ depth: 1 }, "%O %O", m, s));
console.log(formatWithOptions({ depth: 2 }, "rest", m));
