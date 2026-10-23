'use strict'
var list = require('reqarr')

function isTrue (v) {
  return v === 't'
}

exports.flags = function (value) {
  if (!value) return null
  return list.parse(value, isTrue)
}

exports.plain = function (value) {
  return list.parse(value)
}
