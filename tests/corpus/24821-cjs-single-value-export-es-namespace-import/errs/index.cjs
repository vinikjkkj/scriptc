'use strict'

const Errors = process.version.charCodeAt(1) < 55 && process.version.charCodeAt(2) === 46
  ? require('./lib/old.cjs') // Node.js < 7
  : require('./lib/modern.cjs')

module.exports = Errors
