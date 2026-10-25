// A computed prototype read on a class that extends a built-in base (EventEmitter), as mysql2's Connection does.
import EventEmitter from 'events';
class Base extends EventEmitter {
  constructor() { super(); this.n = 3; }
  close() { return 'close:' + this.n; }
  escape(s) { return 'esc(' + s + ')'; }
}
const names = ['close', 'escape', 'missing'];
for (const func of names) {
  console.log(func, typeof Base.prototype[func]);
}
