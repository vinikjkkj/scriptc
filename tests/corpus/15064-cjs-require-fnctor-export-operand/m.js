'use strict'
console.log('m init')
const PG = function (C) {
  this.Client = C || function Fallback() {}
  this.tag = 'pgish'
}
module.exports = new PG(function Real() {})
