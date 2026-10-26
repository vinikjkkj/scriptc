"use strict"
var counters = require("./counter.cjs")

function makeTotal (list) {
  var total = new counters.Counter(0)
  for (var i = 0; i < list.length; i++) total.add(list[i])
  return total
}

exports.makeTotal = makeTotal
exports.Counter = counters.Counter
