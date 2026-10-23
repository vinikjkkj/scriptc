const EventEmitter = require('events');
class Q extends EventEmitter {
  constructor() { super(); this._fields = []; this.idx = 0; }
  next(rs) {
    this._fields.push(void 0);
    this.emit('fields', void 0);
    this.emit('result', rs);
  }
  got(fields) {
    this._fields[this.idx] = fields;
    this.emit('fields', fields);
    this.emit('result', fields, this.idx);
  }
}
const q = new Q();
q.on('fields', (f) => console.log('fields', f));
q.on('result', (r, i) => console.log('result', r, i));
q.next({ a: 1 });
q.got(['x']);
class R extends EventEmitter {
  go() {
    this.emit('tick');
    this.emit('tick', 1);
    this.emit('tick', 'a', { k: 2 });
    this.emit('tick', void 0, void 0, 'last');
  }
}
const r = new R();
r.on('tick', (a, b, c) => console.log('tick3', a, b, c));
r.once('tick', function (a) { console.log('once', a); });
r.on('tick', () => console.log('tick0'));
r.go();
console.log(r.listenerCount('tick'));
