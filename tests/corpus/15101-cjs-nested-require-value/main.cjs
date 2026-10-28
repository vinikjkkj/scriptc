'use strict'
const TO = require('./overrides.cjs')
const PG = function (clientConstructor) { this.types = require('./types.cjs'); this.C = clientConstructor }
const pg = new PG(function C() {})
console.log(pg.types.getTypeParser(20)('8'), pg.types.builtins.BOOL, typeof pg.C)
const o = new TO()
console.log(o._types === pg.types, o._types.arrayParser.create('y'))
pg.types.setTypeParser(20, function (v) { return 'w' + v })
console.log(o.getTypeParser(20)('9'), require('./types.cjs') === pg.types)
