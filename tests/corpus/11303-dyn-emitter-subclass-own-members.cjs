'use strict';
// A program subclass of EventEmitter with its own method keeps that method
// through an untyped receiver, the emitter calls on the same untyped receiver
// still reach the builtin emitter, and a subclass without the method answers
// Node's TypeError for it.
const EventEmitter = require('events');
class Tagged extends EventEmitter {
  constructor() { super(); this.name = 'tagged'; }
  tag() { return 'T:' + this.name; }
}
class Quiet extends EventEmitter {}
function sub(src) {
  src.on('e', (v) => console.log('e got', v));
  console.log('count', src.listenerCount('e'));
  try {
    console.log('tag', src.tag());
  } catch (e) {
    console.log('no tag', e instanceof TypeError, e.message);
  }
}
sub(new Tagged());
sub(new Quiet());
