class Packet {
  constructor(v) { this.v = v; }
  get double() { return this.v * 2; }
}
module.exports.Packet = Packet;
