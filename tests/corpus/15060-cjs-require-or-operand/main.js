'use strict'
function pick(opts) {
  return opts.Client || require('./m').X
}
function pick2(opts, C) {
  return opts.Client || C || require('./m').F
}
console.log('start')
console.log(pick({ Client: 'given' }))
console.log('after given')
console.log(pick({}))
console.log(pick({}))
console.log(typeof pick2({}, null))
console.log(pick2({}, 'c2').name)
