'use strict'
function pick(flag) {
  return flag ? require('./m').X : 'no-m'
}
function pickF(flag) {
  return flag && require('./m').F
}
function pickN(v) {
  return v ?? require('./m').X
}
console.log('a', pick(false))
console.log('b', pickF(false))
console.log('c', typeof pickF(true))
console.log('d', pickN(null))
console.log('e', pickN('kept'))
