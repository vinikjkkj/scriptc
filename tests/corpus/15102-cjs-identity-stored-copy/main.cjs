'use strict'
const s = require('./store.cjs')
const holder = { ref: s }
console.log(holder.ref === require('./store.cjs'), holder.ref === s, s.self === s)
function touch(obj, n) { obj.count = n; obj.label = 'l' + n }
touch(holder.ref, 4)
console.log(require('./store.cjs').count, s.show(), typeof holder.ref)
holder.ref.extra = 'e'
console.log(require('./store.cjs').extra, Object.keys(s).join(','))
