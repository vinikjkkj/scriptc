// An ES default import of a CommonJS module whose `module.exports = Errors` is not a table: members of the default import read through the one value.
import errs from './errs/index.cjs'
console.log(new errs.ReplyError('boom').name, new errs.AbortError('x') instanceof errs.RedisError, typeof errs.InterruptError)
