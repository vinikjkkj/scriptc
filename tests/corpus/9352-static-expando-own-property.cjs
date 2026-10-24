'use strict';
// An undeclared static of a class is created by a static method (mysql2's Packet.MockBuffer memo): first read is undefined, the write happens inside the method, later reads return the stored value by identity.
class Packet {
  static MockBuffer() {
    if (Packet._mockBuffer) {
      return Packet._mockBuffer;
    }
    const res = [1, 2];
    Packet._mockBuffer = res;
    return res;
  }
  static size() { return Packet.MockBuffer().length; }
}
console.log(Packet._mockBuffer === undefined, Packet.size());
const first = Packet.MockBuffer();
console.log(first === Packet._mockBuffer, first.join(','));
Packet._tag = 'tagged';
console.log(Packet._tag, Packet._mockBuffer.length);
