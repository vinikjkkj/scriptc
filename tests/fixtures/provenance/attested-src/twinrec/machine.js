'use strict';
const EventEmitter = require('events').EventEmitter;

// mysql2's Command shape: each state is a method that answers the NEXT state, a method of its own class.
class Command extends EventEmitter {
  constructor() {
    super();
    this.next = null;
    this.log = [];
  }
  execute(packet, connection) {
    if (!this.next) this.next = this.start;
    this.next = this.next(packet, connection);
    return this.next === null;
  }
}

class Query extends Command {
  constructor(count) {
    super();
    this.count = count;
    this.seen = 0;
  }
  start(packet, connection) {
    return this.resultsetHeader;
  }
  resultsetHeader(packet, connection) {
    if (packet === 'err') return connection.protocolError('bad header');
    this.seen = 0;
    this.log.push('header');
    return this.readField;
  }
  readField(packet, connection) {
    this.seen++;
    this.log.push('field:' + packet);
    if (this.seen === this.count) return Query.prototype.fieldsEOF;
    return Query.prototype.readField;
  }
  fieldsEOF(packet, connection) {
    if (packet !== 'eof') return connection.protocolError('expected eof');
    return this.row;
  }
  row(packet, connection) {
    if (packet === 'end') return null;
    this.log.push('row:' + packet);
    return Query.prototype.row;
  }
}

class Execute extends Query {
  resultsetHeader(packet, connection) {
    this.log.push('x-header');
    this.seen = 0;
    return this.readField;
  }
  readField(packet, connection) {
    this.seen++;
    this.log.push('x-field:' + packet);
    if (this.seen === this.count) return Execute.prototype.fieldsEOF;
    return Execute.prototype.readField;
  }
  fieldsEOF(packet, connection) {
    this.log.push('x-eof');
    return super.fieldsEOF(packet, connection);
  }
}

class Handshake extends Command {
  start(packet, connection) {
    this.log.push('hello');
    return Handshake.prototype.dispatchCommands;
  }
  dispatchCommands(packet, connection) {
    if (packet === 'quit') return null;
    this.log.push('cmd:' + packet);
    return Handshake.prototype.dispatchCommands;
  }
}

exports.Query = Query;
exports.Execute = Execute;
exports.Handshake = Handshake;
