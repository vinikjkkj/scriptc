'use strict'
const pgTypes = { parsers: {}, set(k, v) { this.parsers[k] = v } }
let stored = 'init'
module.exports = { port: 5432, rows: 0 }
module.exports.__defineSetter__('parseInt8', function (val) {
  pgTypes.set(20, val ? 'int4' : 'int8')
  stored = 'set:' + String(val)
})
module.exports.__defineGetter__('stored', function () { return stored })
module.exports.portNow = function () { return module.exports.port }
