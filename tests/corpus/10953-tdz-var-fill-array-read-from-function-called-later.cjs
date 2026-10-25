"use strict"
// A function declared ABOVE a `var` of `new Array(n)` reads it, and the call
// comes after the declaration. The window (the function's declaration line and
// the var) holds only inert statements, so this is the ordinary forward read.
function total () { return LEDGER.length + LEDGER[2] }
var LEDGER = new Array(3)
for (var j = 0; j < 3; j++) { LEDGER[j] = j + 10 }
console.log(total(), LEDGER.join(" "))
