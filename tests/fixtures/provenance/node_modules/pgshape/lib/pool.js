'use strict'
const EventEmitter = require('events').EventEmitter

class Pool extends EventEmitter {
  constructor(options, Client) {
    super()
    this.options = Object.assign({ max: 10 }, options)
    this.Client = Client
    this.ended = false
  }
  describe() {
    return `${this.options.host}:${this.options.port} max=${this.options.max} client=${this.Client.kind}`
  }
  end() {
    this.ended = true
    return Promise.resolve()
  }
}

module.exports = Pool
