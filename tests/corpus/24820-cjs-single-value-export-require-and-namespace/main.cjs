'use strict'
// `module.exports = Errors` over a variable bound to a conditional require (redis-errors' entry): the whole export is one value, read through
// require("...").Member, as a whole, and destructured.
exports.ReplyError = require('./errs/index.cjs').ReplyError
const e = new exports.ReplyError('boom')
console.log(e.name, e instanceof Error, e.message)
const whole = require('./errs/index.cjs')
console.log(typeof whole, Object.keys(whole).join(','), whole === require('./errs/index.cjs'))
const { RedisError, AbortError } = require('./errs/index.cjs')
console.log(new RedisError('x').name, new AbortError('y').name, typeof whole.InterruptError)
console.log(new whole.ParserError('p', Buffer.from('ab'), 3).offset)
