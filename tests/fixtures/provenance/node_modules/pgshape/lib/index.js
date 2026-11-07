'use strict'

const Client = require('./client')
const Pool = require('./pool')

// A class minted per call: a fresh identity (and its own captured Client) at every evaluation.
const poolFactory = (Client) => {
  return class BoundPool extends Pool {
    constructor(options) {
      super(options, Client)
    }
  }
}

const PG = function (clientConstructor) {
  this.Client = clientConstructor
  this.Pool = poolFactory(this.Client)
}

module.exports = new PG(Client)
