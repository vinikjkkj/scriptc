'use strict'
const v = require('./cyc1').later() || 'nothing'
console.log('cyc main', v)
let nothing = undefined
const w = (nothing || require('./cyc2').back)
console.log('cyc main2', w)
const c = require('./cyc1')
console.log('cyc main3', c.name, typeof c.later)
