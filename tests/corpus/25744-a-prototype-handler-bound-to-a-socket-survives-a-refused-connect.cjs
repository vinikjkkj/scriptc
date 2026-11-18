// mysql2's exact listener shape: the handler is read off the prototype and bound, then registered on the socket
// that refuses its connect. The handler clears the connect timer and writes null over the field; the refusal
// reaches the owner as an 'error' event and nothing is uncaught.
const net = require('net')
const Timers = require('timers')
const { EventEmitter } = require('events')

class Conn extends EventEmitter {
  constructor(port) {
    super()
    this.fatal = null
    this.stream = net.connect(port, '127.0.0.1')
    this.stream.on('error', Conn.prototype.onNetworkError.bind(this))
    this.connectTimeout = Timers.setTimeout(() => console.log('timeout (must not fire)'), 5000)
  }
  onNetworkError(err) {
    if (this.connectTimeout) {
      Timers.clearTimeout(this.connectTimeout)
      this.connectTimeout = null
    }
    this.fatal = err
    console.log('handled', err.code, err.syscall, this.connectTimeout)
    this.emit('error', err)
  }
}

const probe = net.createServer()
probe.listen(0, '127.0.0.1', () => {
  const port = probe.address().port
  probe.close(() => {
    const c = new Conn(port)
    c.once('error', (e) => console.log('owner saw', e.code, e.message === 'connect ECONNREFUSED 127.0.0.1:' + port))
    c.stream.on('close', (h) => console.log('closed', h, c.fatal !== null))
  })
})
