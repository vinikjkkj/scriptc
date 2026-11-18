// mysql2's connection pattern, without mysql2: the constructor stores a timer handle in a field and wires
// stream.on('error', this._handleNetworkError.bind(this)); the handler clears the timer and writes null to
// the field. A refused connect runs the handler, which must write null, not abort the process.
const net = require('net')
const { EventEmitter } = require('events')

class Conn extends EventEmitter {
  constructor(port) {
    super()
    this.connectTimeout = setTimeout(() => console.log('connect timeout fired (must not)'), 5000)
    this._fatalError = null
    this.stream = net.connect(port, '127.0.0.1')
    this.stream.on('error', this._handleNetworkError.bind(this))
    this.stream.on('close', () => { console.log('stream close, fatal kept:', this._fatalError && this._fatalError.code) })
  }
  _handleNetworkError(err) {
    if (this.connectTimeout) {
      clearTimeout(this.connectTimeout)
      this.connectTimeout = null
    }
    this._fatalError = err
    console.log('handled', err.code, err.syscall, this.connectTimeout)
    this.emit('error', err)
  }
}

const probe = net.createServer()
probe.listen(0, '127.0.0.1', () => {
  const port = probe.address().port
  probe.close(() => {
    const c = new Conn(port)
    c.once('error', (e) => console.log('conn error', e.message === 'connect ECONNREFUSED 127.0.0.1:' + port))
  })
})
