'use strict'
const defaults = require('./defaults.cjs')
console.log('port', defaults.port, defaults.rows)
defaults.port = 6543
defaults.rows += 2
console.log('port2', defaults.port, defaults.rows, Object.keys(defaults).join(','))
