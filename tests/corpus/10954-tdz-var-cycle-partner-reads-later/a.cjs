"use strict"
exports.run = Run
var TAB = new Array(2)
TAB[0] = "zero"
TAB[1] = "one"
var B = require("./b.cjs")
exports.partial = function () { return typeof B.name }
function Run () { return TAB.slice(0).join(",") + "|" + B.name() }
console.log("a body", Run())
