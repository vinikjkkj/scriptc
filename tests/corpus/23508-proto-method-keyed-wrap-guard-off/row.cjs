'use strict';
class Row {
  static toPacket(cols) { return { kind: 'row', cols }; }
}
module.exports = Row;
