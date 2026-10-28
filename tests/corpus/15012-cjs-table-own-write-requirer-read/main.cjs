'use strict'
const m = require('./lib.cjs')
console.log('a', m.a, 'b', m.b)
console.log('bump', m.bump(), m.a, m.readA())
m.a = 10
console.log('after write', m.a, m.readA(), m.bump())
m.d = 'new'
console.log('new key', m.d, m.add('zed', 3), m.zed, Object.keys(m).join(','))
m.b += 5
m.b++
console.log('b', m.b, m.readA())
