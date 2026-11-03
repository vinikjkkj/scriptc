'use strict';
const Packet = require('./packet.cjs');
class Ping {
  toPacket() { return new Packet('ping', null); }
}
module.exports = Ping;
