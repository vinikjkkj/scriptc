// The whole mysql2 pool-connection shape on a refused port, without mysql2: a connection whose constructor
// registers once('error') twice (pool removal, then connect(cb)), a handshake-less fatal path that notifies,
// emits 'error', then closes the stream (stream.end() on an errored socket), and a later 'close' that must not
// notify a second time. The app-level callback receives the rejection; nothing is uncaught.
const net = require('net')
const { EventEmitter } = require('events')

class Connection extends EventEmitter {
  constructor(port, pool) {
    super()
    this._pool = pool
    this._fatalError = null
    this._closing = false
    this.connectTimeout = setTimeout(() => {}, 4000)
    this.stream = net.connect(port, '127.0.0.1')
    this.stream.on('error', this._handleNetworkError.bind(this))
    this.stream.on('close', () => {
      if (this._closing) return
      const e = new Error('Connection lost: The server closed the connection.')
      e.code = 'PROTOCOL_CONNECTION_LOST'
      this._notifyError(e)
    })
    this.once('error', () => { pool.removed++ })
  }
  _handleNetworkError(err) {
    if (this.connectTimeout) { clearTimeout(this.connectTimeout); this.connectTimeout = null }
    if (err.code === 'ECONNRESET' && this._closing) return
    err.fatal = true
    this._notifyError(err)
    this._fatalError = err
  }
  _notifyError(err) {
    if (this.connectTimeout) { clearTimeout(this.connectTimeout); this.connectTimeout = null }
    if (this._fatalError) return
    this.emit('error', err)
    if (err.fatal) this.close()
  }
  close() {
    this._closing = true
    this.stream.end()
  }
  connect(cb) {
    const onError = (e) => cb(e)
    this.once('error', onError)
  }
}

const probe = net.createServer()
probe.listen(0, '127.0.0.1', () => {
  const port = probe.address().port
  probe.close(() => {
    const pool = { removed: 0 }
    const conn = new Connection(port, pool)
    new Promise((resolve, reject) => conn.connect((e) => (e ? reject(e) : resolve(conn)))).then(
      () => console.log('connected (must not)'),
      (e) => {
        console.log('FAILED to reach:', String(e).replace(String(port), '<port>'))
        setTimeout(() => console.log('alive', pool.removed, conn._closing, conn.stream.destroyed), 100)
      },
    )
  })
})
