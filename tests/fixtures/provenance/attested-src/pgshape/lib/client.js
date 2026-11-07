'use strict'
class Client {
  constructor(config) {
    this.config = config
  }
}
Client.kind = 'pg-client'
module.exports = Client
