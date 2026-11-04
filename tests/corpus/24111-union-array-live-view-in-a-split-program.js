"use strict";
// An array of unions crosses into a dynamic parameter: its live view owns a data table (sc_velem_N) that a program split into several
// translation units must define once. tests/harness/tu-split.test.ts forces the split over this row.
const mixed = [1, "x", 2, "y"];
function describe(v) { return v.length + ":" + v.join("|"); }
function push(v, item) { v.push(item); return v.length; }
console.log(describe(mixed));
console.log(push(mixed, "z"), mixed.length, mixed[4]);
const nums = [3, "q"];
console.log(describe(nums), push(nums, 4), nums.join(","));
