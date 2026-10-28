'use strict'
let hits = 0
module.exports = { name: 'cfg' }
module.exports.__defineGetter__('hits', function () { hits++; return hits })
module.exports.__defineSetter__('mode', function (v) { this.stash = v })
