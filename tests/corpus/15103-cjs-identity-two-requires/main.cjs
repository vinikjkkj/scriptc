'use strict'
const a = require('./store.cjs')
const b = require('./store.cjs')
console.log(a === b, a !== b, a == b, a.self === b)
a.count = 9
console.log(b.count, b.show(), require('./store.cjs') === a)
