'use strict';
const Query = require('./query.cjs');
const Ping = require('./ping.cjs');
const Auth = require('./auth.cjs');
const Row = require('./row.cjs');
const ctorMap = { Query, Ping, Auth, Row };
Object.entries(ctorMap).forEach(([name, ctor]) => {
  module.exports[name] = ctor;
  if (process.env.SCRIPTC_SQ7_NEVER_SET) {
    if (ctor.prototype.toPacket) {
      const old = ctor.prototype.toPacket;
      ctor.prototype.toPacket = function () {
        const p = old.call(this);
        p._name = name;
        return p;
      };
    }
  }
});

const Packet = require('./packet.cjs');
class OK {
  static toPacket() {
    const packet = new Packet('ok', 1);
    packet._name = 'OK';
    return packet;
  }
}
exports.OK = OK;
