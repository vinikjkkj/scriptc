// mysql2 Command shape: the base class reads `this.start`, a method only its subclasses declare (implicit-any
// parameters), stores it in `this.next` and invokes it later as `this.next(packet, connection)`. The read takes the
// function of the receiver's RUNTIME class; stateName() compares every enumerable field with it (methods are
// non-enumerable, so nothing matches).
'use strict';
const EventEmitter = require('events').EventEmitter;

class Command extends EventEmitter {
  constructor() {
    super();
    this.next = null;
  }
  stateName() {
    const state = this.next;
    for (const i in this) {
      if (this[i] === state && i !== 'next') {
        return i;
      }
    }
    return 'unknown name';
  }
  execute(packet, connection) {
    if (!this.next) {
      this.next = this.start;
      connection.resets++;
    }
    this.next = this.next(packet, connection);
    if (this.next) {
      return false;
    }
    this.emit('end');
    return true;
  }
}

class Query extends Command {
  constructor(sql) {
    super();
    this.sql = sql;
  }
  start(_packet, connection) {
    connection.log.push('query.start ' + this.sql);
    return this.row;
  }
  row(packet, connection) {
    connection.log.push('query.row ' + packet);
    return null;
  }
}

class Execute extends Command {
  constructor(sql) {
    super();
    this.sql = sql;
  }
  start(packet, connection) {
    connection.log.push('execute.start ' + this.sql + ' ' + packet);
    return this.fields;
  }
  fields(packet, connection) {
    connection.log.push('execute.fields ' + packet);
    return null;
  }
}

class Ping extends Command {
  constructor() {
    super();
  }
  start(packet, connection) {
    connection.log.push('ping.start');
    return null;
  }
}

const connection = { resets: 0, log: [] };
function drive(c) {
  c.on('end', () => connection.log.push('end'));
  console.log(c.execute('p', connection), c.stateName());
  if (c.next) console.log(c.execute('q', connection));
}
drive(new Query('select 1'));
drive(new Execute('select 2'));
drive(new Ping());
console.log(connection.log.join('|'), connection.resets);
