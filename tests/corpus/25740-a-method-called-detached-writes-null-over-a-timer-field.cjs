// The detached variant of a method (its receiver arrives raw, through Function.prototype.call) writes null over
// a field whose checked type is Timeout | undefined, as mysql2's _handleNetworkError does after clearing its
// connect timer. The write stores null; it does not abort with "null is not representable in the target union".
const Timers = require('timers')
const { EventEmitter } = require('events')

class Conn extends EventEmitter {
  constructor(opts) {
    super()
    this.config = opts.config
    this.fatal = null
    if (this.config.connectTimeout) {
      this.connectTimeout = Timers.setTimeout(() => console.log('timeout (must not fire)'), this.config.connectTimeout)
    }
  }
  onNetworkError(err) {
    if (this.connectTimeout) {
      Timers.clearTimeout(this.connectTimeout)
      this.connectTimeout = null
    }
    this.fatal = err
    console.log('handled', err.code, this.connectTimeout)
  }
}

const c = new Conn({ config: { connectTimeout: 5000 } })
const handler = Conn.prototype.onNetworkError
const e = new Error('x')
e.code = 'ECONNREFUSED'
handler.call(c, e)
console.log(c.fatal !== null, c.connectTimeout)
handler.call(c, e)
console.log('second call, no timer left', c.connectTimeout)
