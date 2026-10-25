// Computed prototype reads by literal key on a class that extends a built-in base (EventEmitter), as mysql2's Connection does.
import EventEmitter from 'events';
class Base extends EventEmitter {
  constructor() { super(); this.n = 3; }
  close() { return 'close:' + this.n; }
  escape(s) { return 'esc(' + s + ')'; }
}
console.log('close', typeof Base.prototype['close']);
console.log('escape', typeof Base.prototype['escape']);
console.log('missing', typeof Base.prototype['missing']);
