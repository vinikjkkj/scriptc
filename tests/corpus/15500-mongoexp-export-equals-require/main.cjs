// @transform-types
'use strict'
const sp = require('./lib.ts')
const { saslprep, saslprep: renamed } = require('./lib.ts')
console.log(sp('abc'), sp('x', { allowUnassigned: true }))
console.log(sp.default('q'), sp.saslprep('r'), sp.tag, typeof sp, sp.default === sp)
console.log(saslprep('m'), renamed('n'), typeof saslprep, renamed === sp)
