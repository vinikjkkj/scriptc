"use strict"
// Another module calls an exported hoisted function whose body reads a var of
// `new Array(n)` declared below the export. dep.cjs finishes its body before
// main sees it, so the var is always filled by the time the export is called.
var dep = require("./dep.cjs")
var x = dep.make(5)
console.log(x.n, x.t.length, x.size, x.t[3], dep.peek(2), dep.count())
