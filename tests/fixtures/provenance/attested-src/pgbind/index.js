'use strict'
const EventEmitter = require('events').EventEmitter
class Client extends EventEmitter {
  constructor(config) { super(); this.config = config }
}
class Pool extends EventEmitter {
  constructor(options, Client) {
    super()
    this.options = Object.assign({ max: 10 }, options)
    this.Client = Client
    this.tag = 'pool'
  }
  query(text, values, cb) {
    if (typeof values === 'function') { cb = values; values = undefined }
    let cfg = typeof text === 'object' ? text : { text, values }
    const r = { rows: [this.tag + ':' + cfg.text + ':' + JSON.stringify(cfg.values || [])], rowCount: 1 }
    if (cb) { cb(null, r); return undefined }
    return Promise.resolve(r)
  }
  end() { return Promise.resolve() }
}
const poolFactory = (Client) => class BoundPool extends Pool {
  constructor(options) { super(options, Client) }
}
const PG = function (clientConstructor) {
  this.Client = clientConstructor
  this.Pool = poolFactory(this.Client)
}
module.exports = new PG(Client)
