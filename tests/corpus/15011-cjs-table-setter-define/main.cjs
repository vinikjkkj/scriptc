'use strict'
const defaults = require('./defaults.cjs')
console.log('stored', defaults.stored, defaults.portNow())
defaults.parseInt8 = true
console.log('after set', defaults.stored, defaults.parseInt8 === undefined)
defaults.port = 6543
console.log('port2', defaults.port, defaults.portNow())
console.log(Object.keys(defaults).join(','))
