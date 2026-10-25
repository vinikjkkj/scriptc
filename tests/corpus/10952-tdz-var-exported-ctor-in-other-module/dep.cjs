"use strict"
exports.make = Make
exports.peek = function (k) { return TABLE[k] }
exports.count = function () { return TABLE.length }

var TABLE = new Array(4)
var LIMIT = 2
for (var i = 0; i < 4; i++) TABLE[i] = i * LIMIT

function Make (n) { return { n: n, t: TABLE.slice(0), size: TABLE.length + n } }
