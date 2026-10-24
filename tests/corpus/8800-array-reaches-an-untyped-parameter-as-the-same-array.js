// An array handed to a function whose parameter has no type is the SAME
// array in JavaScript: the callee's push, sort, index writes and length
// writes change the object the caller still names, and the caller's later
// writes are visible to anything that kept it. The static number[] / string[]
// / boolean[] and the untyped value are different memory, so the crossing
// used to COPY: a write through the copy threw "the crossing COPIES them" and
// a read of a kept copy answered the length it had when it was made. The copy
// is now a live view of its origin: reads answer from the origin, writes are
// committed to it.
'use strict';

function addN(a, n) { for (let i = 0; i < n; i++) a.push(i * 2); }
function ops(a) {
  a.push(5, 6);
  a.unshift(0);
  const p = a.pop();
  const s = a.shift();
  a.reverse();
  a.sort((x, y) => x - y);
  a.splice(1, 1, 9, 9);
  a.fill(7, 0, 1);
  a[a.length] = 42;
  a[0] = 1;
  a.length = a.length - 1;
  return [p, s, a.length, a.join(",")].join("|");
}
function sum(a) { let t = 0; for (let i = 0; i < a.length; i++) t += a[i]; return t; }
function same(a) { return a; }

const xs = [3, 1, 2];
console.log(ops(xs), xs.length, xs.join(","), JSON.stringify(xs));

const ys = [1, 2];
addN(ys, 4);
console.log(ys.length, ys.join(","), sum(ys), Math.max(...ys));

const names = ["b", "a"];
function strs(a) { a.push("c"); a.sort(); a.unshift("z"); a[1] = "Q"; return a.length; }
console.log(strs(names), names.join(","));

const flags = [true, false];
function bools(a) { a.push(true); a.reverse(); a[0] = false; return a.length; }
console.log(bools(flags), flags.join(","));

// elements of arrays, fields, and call results are arrays the caller names too
const grid = [[1, 2], [3]];
addN(grid[0], 2);
console.log(grid[0].length, grid[0].join(","), grid.length);

class Box { constructor() { this.list = [1, 2]; } }
const box = new Box();
addN(box.list, 1);
console.log(box.list.length, box.list.join(","));

function mk() { return [1, 2]; }
const made = mk();
addN(made, 2);
console.log(made.length, made.join(","));

// a function that returns what it was given, and a callee that calls another
const back = same(xs);
back.push(100);
console.log(xs.length, xs[xs.length - 1], back.length);
function outer(a) { addN(a, 2); return a.length; }
const zs = [9];
console.log(outer(zs), zs.join(","));
