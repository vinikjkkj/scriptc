'use strict';

// Symbol keys exported through a CommonJS table and imported by name, the
// way ws's constants.js shares kWebSocket between its classes.
const { kOwner, kCount, LIMIT } = require('./constants');

class Receiver {
  constructor() {
    this[kOwner] = '';
    this[kCount] = 0;
  }

  bump() {
    this[kCount] += 1;
    return this[kCount] < LIMIT;
  }
}

class Sender {
  constructor() {
    this[kOwner] = 'sender';
  }
}

const r = new Receiver();
const s = new Sender();
r[kOwner] = 'receiver';
console.log(r[kOwner], s[kOwner], r[kCount]);
console.log(r.bump(), r.bump(), r.bump(), r[kCount]);
