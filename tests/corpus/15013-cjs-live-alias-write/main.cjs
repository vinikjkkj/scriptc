'use strict'
const s = require('./store.cjs')
function touch(obj, n) { obj.count = n; obj.label = 'l' + n }
touch(s, 4)
console.log(s.show(), s.self.count, s.self === s)
s.self.count = s.self.count + 1
console.log(s.show(), s.count)
s.extra = { deep: 1 }
console.log(Object.keys(s).join(','), s.extra.deep)
