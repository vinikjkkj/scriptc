"use strict"
// A two-module require cycle. Module a.cjs exports Run before its own `var`
// of `new Array(2)`; the window between the export and that var is inert, so
// the read inside Run is not early. b.cjs requires a while a is still partly
// initialised, but reads a's export only inside a function, and it reads its
// own array below its own declaration. Node and scriptc print the same.
var a = require("./a.cjs")
console.log("main", a.run(), a.partial())
