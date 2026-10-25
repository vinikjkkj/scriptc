"use strict"
var A = require("./a.cjs")
exports.name = Name
var SUF = new Array(1)
SUF[0] = "b"
function Name () { return SUF.slice(0).join("") }
exports.early = function () { return typeof A.run }
