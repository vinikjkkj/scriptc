'use strict'
const c = require('./config.cjs')
console.log(c.name, c.hits, c.hits)
c.mode = 'fast'
console.log(c.stash)
console.log(Object.keys(c).join(','))
