'use strict'
function pick(opts) {
  return opts.Client || require('./m').Client
}
function tagOf(flag) {
  return flag || require('./m').tag
}
console.log('start')
console.log(pick({ Client: 'given' }))
const c = pick({})
console.log('client', typeof c, c.name)
console.log('tag', tagOf(false), tagOf('kept'))
