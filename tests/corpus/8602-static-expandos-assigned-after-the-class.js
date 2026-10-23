'use strict';

const log = [];

class Command {
  /** @param {string} name */
  constructor(name) {
    this.name = name;
  }
  /** @param {string} name */
  static isDisconnecting(name) {
    return Command.FLAGS.WILL_DISCONNECT.indexOf(name) !== -1;
  }
  static retries() {
    return Command.defaults.retries + Command.counter;
  }
  describe() {
    return `${this.name}:${Command.label}`;
  }
}
Command.FLAGS = {
  VALID_IN_SUBSCRIBER_MODE: ['subscribe', 'ping'],
  WILL_DISCONNECT: ['quit'],
};
Command.defaults = { retries: 20 };
Command.counter = (log.push('counter'), 3);
Command.label = 'cmd';
/** @param {string} name */
Command.make = function (name) {
  return new Command(name);
};

class Plain {
  static twice(n) {
    return n * 2;
  }
}
Plain.base = 21;
log.push('between');

console.log(Command.isDisconnecting('quit'), Command.isDisconnecting('get'));
console.log(Command.retries(), Command.make('set').describe(), Command.FLAGS.VALID_IN_SUBSCRIBER_MODE.length);
console.log(Plain.twice(Plain.base), log.join(','));
