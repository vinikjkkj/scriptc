// util.inspect options written as LITERAL objects: the same knobs on Map,
// Set, nested records and long arrays, plus the sorted and numericSeparator
// forms and the caps that arrays and maps honor.
import util from "node:util";

const m = new Map<string, number>([["alpha", 1], ["beta", 22222], ["gamma", 333333], ["delta", 4], ["eps", 5], ["zeta", 6], ["eta", 7]]);
const s = new Set<number>([1234567, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
const big: number[] = Array.from({ length: 130 }, (_, i) => (i * 7919) % 100003);
const rec = { z: 1, y: { c: 3, b: 2, a: 1 }, x: [9, 8, 7] };
const nums = [1234567, 1234.5678, 0.000012345, -1234567.5, 1e21, 1e-7, 42, 999999];

console.log(util.inspect(m, { maxArrayLength: 2 }));
console.log(util.inspect(m, { maxArrayLength: 0 }));
console.log(util.inspect(s, { breakLength: 30, compact: 2 }));
console.log(util.inspect(big, { maxArrayLength: 5, numericSeparator: true }));
console.log(util.inspect(big, { breakLength: Infinity, compact: 6 }));
console.log(util.inspect(rec, { sorted: true }));
console.log(util.inspect(rec, { sorted: true, compact: false }));
console.log(util.inspect(nums, { numericSeparator: true, breakLength: 24 }));
console.log(util.inspect({ text: "lorem ipsum dolor sit amet lorem ipsum\nsecond line" }, { maxStringLength: 12, breakLength: 30 }));
console.log(util.inspect({ deep: { deeper: { deepest: [1, 2] } } }, { depth: 1, sorted: true }));
console.log(util.inspect(rec, { colors: false, customInspect: true, showHidden: false, getters: false, showProxy: false }));
