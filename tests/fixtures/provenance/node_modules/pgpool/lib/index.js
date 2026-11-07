'use strict'
const EventEmitter = require('events').EventEmitter

class Client extends EventEmitter {
  constructor(config) {
    super()
    this.config = config
    this.connected = false
  }
  // An async method has no dyn form: the class's member table is opaque, but it NAMES what it skipped.
  async ping() { return true }
  connect(cb) {
    this.connected = true
    cb(undefined)
  }
}

class Pool extends EventEmitter {
  constructor(options, ClientClass) {
    super()
    this.options = options
    this.Client = this.options.Client || ClientClass || Client
    this.idle = []
  }
  acquire(cb) {
    const client = new this.Client(this.options)
    client.connect((err) => {
      client.release = () => this._release(client)
      cb(err, client)
    })
  }
  // `client` is an untyped parameter: the writes below name members the Client class never declares.
  _release(client) {
    client._poolUseCount = (client._poolUseCount || 0) + 1
    this.idle.push(client)
    return client._poolUseCount
  }
}

const factory = (ClientClass) => class BoundPool extends Pool {
  constructor(options) {
    super(options, ClientClass)
  }
}

module.exports = { Client, Pool: factory(Client) }
