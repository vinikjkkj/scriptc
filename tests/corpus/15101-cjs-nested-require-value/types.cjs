'use strict'
var parsers = { text: {}, binary: {} }
function noParse(val) { return String(val) }
function getTypeParser(oid, format) { format = format || 'text'; return parsers[format][oid] || noParse }
function setTypeParser(oid, format, fn) {
  if (typeof format == 'function') { fn = format; format = 'text' }
  parsers[format][oid] = fn
}
exports.getTypeParser = getTypeParser
exports.setTypeParser = setTypeParser
exports.arrayParser = { create: function (s) { return 'arr:' + s } }
exports.builtins = { BOOL: 16, INT8: 20 }
