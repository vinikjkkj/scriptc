'use strict'
const TO = require('./overrides.cjs')
const t = require('./types.cjs')
const o = new TO()
const custom = new TO({ getTypeParser: function () { return 'custom' } })
console.log(o.getTypeParser(20)('7'), o._types === t, custom._types.getTypeParser(1))
