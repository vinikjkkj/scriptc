"use strict"
// The window between a hoisted function's exported activation and a module
// `var` of `new Array(n)` holds only inert statements (literal vars, a store
// into exports, a closure creation). Nothing can call the function before the
// array is filled, so its reads of the var are NOT an early read. The reader
// is also reached through a closure created above the var and called below it.
exports.peek = Peek
exports.early = 3

var SIZE = 4
var TABLE = new Array(SIZE)
for (var i = 0; i < SIZE; i++) { TABLE[i] = i * exports.early }
exports.later = function () { return Peek(2) + TABLE.length }

function Peek (k) { return TABLE[k] }

console.log(exports.peek(3), exports.later(), TABLE.slice(0).join(","))
console.log(Peek(1), exports.early, typeof exports.later)
