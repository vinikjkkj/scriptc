// JavaScript arrays are not typed: a function that takes an array in an
// untyped parameter may store a string, an object or undefined into what the
// caller built as [1, 2]. The array literal handed to such a parameter is a
// dynamic array from creation, so the caller's later reads see every element
// exactly as Node does. (A callee that only stores the element type keeps
// the array static; see 8800.)
'use strict';

function p(arr, v) { arr.push(v); }
const b = [1, 2];
p(b, "y");
p(b, {});
console.log(b.length, b[2], typeof b[3], b.join("|"));
for (const x of b) console.log(typeof x);

function mid(a, v) { inner(a, v); }
function inner(a, v) { a[a.length] = v; }
function names() {
  const ns = ["a", "b"];
  mid(ns, 7);
  mid(ns, "z");
  console.log(ns.length, ns[2], ns[3], JSON.stringify(ns));
}
names();

function setAt(a, i, v) { a[i] = v; }
const flags = [true, false];
setAt(flags, 0, "no");
setAt(flags, 5, null);
console.log(flags.length, flags[0], flags[5], flags[3]);

function fillWith(a, v) { a.fill(v); }
const nums = [1, 2, 3];
fillWith(nums, undefined);
console.log(nums.length, nums[0], nums.join(","));
