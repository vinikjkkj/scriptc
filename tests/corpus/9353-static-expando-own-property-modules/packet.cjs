'use strict';
class Packet {
  static lengthCodedNumberLength(n) { return n < 251 ? 1 : 3; }
  static MockBuffer() {
    if (Packet._mockBuffer) return Packet._mockBuffer;
    const noop = function () {};
    const res = [noop, 2];
    Packet._mockBuffer = res;
    return res;
  }
}
module.exports = Packet;
