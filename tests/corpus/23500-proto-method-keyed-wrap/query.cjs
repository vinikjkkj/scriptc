'use strict';
const Packet = require('./packet.cjs');
class Query {
  constructor(q) { this.q = q; }
  toPacket() { return new Packet('query', this.q); }
}
module.exports = Query;
