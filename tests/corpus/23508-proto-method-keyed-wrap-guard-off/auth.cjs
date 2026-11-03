'use strict';
const Packet = require('./packet.cjs');
class Auth {
  constructor(n) { this.n = n; }
  toPacket(encoding) { return new Packet('auth', [this.n, encoding]); }
}
module.exports = Auth;
