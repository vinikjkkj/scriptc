'use strict'
const o: any = {}
let seen = 'none'
o.__defineSetter__('x', function (v: any) { seen = 'set:' + v })
o.__defineGetter__('y', function () { return 7 })
o.x = 4
console.log(seen, o.y, Object.keys(o).join(','))
