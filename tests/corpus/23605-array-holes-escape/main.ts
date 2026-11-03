// Arrays with holes ESCAPE (a return value, an exported binding, a class field, an argument):
// the hole travels with the array, in every element kind.
import { table, make, Holder, describe } from "./mod.ts";

console.log(table, table.length, 0 in table, 2 in table, Object.keys(table));
const m = make(5);
console.log(m, m.length, 0 in m, 4 in m);
const h = new Holder(3);
h.cells[2] = "c";
console.log(h.cells, 0 in h.cells, 2 in h.cells, h.size());
console.log(describe(table.slice()), describe(Array.from(m)));
const nums = h.nums;
console.log(nums, nums.length, 1 in nums);
nums[1] = 1.5;
console.log(nums, 1 in nums, nums.map((v) => v * 2));
const copy = h.cells.slice();
copy[0] = "z";
console.log(copy, h.cells);
