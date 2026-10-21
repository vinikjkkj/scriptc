// What ws does to WebSocket.prototype after the class body: instance
// constants, enumerable-only redefinitions of members the class already
// declares, and the on<event> accessor family unrolled from a literal array.
const levels = ['LOW', 'HIGH'];

class Hub {
  constructor() {
    this._handlers = [];
    this._kind = 'hub';
    this.fired = '';
  }

  get kind() {
    return this._kind;
  }

  get size() {
    return this._handlers.length;
  }

  fire(name, arg) {
    for (const h of this._handlers) {
      if (h.name === name) h.fn(arg);
    }
  }

  listen(name, fn) {
    this._handlers.push({ name, fn });
  }

  last(name) {
    let found = null;
    for (const h of this._handlers) {
      if (h.name === name) found = h.fn;
    }
    return found;
  }
}

Object.defineProperty(Hub.prototype, 'LOW', { enumerable: true, value: levels.indexOf('LOW') });
Object.defineProperty(Hub.prototype, 'HIGH', { enumerable: true, value: levels.indexOf('HIGH') });

['kind', 'size'].forEach((property) => {
  Object.defineProperty(Hub.prototype, property, { enumerable: true });
});

['open', 'close', 'message'].forEach((method) => {
  Object.defineProperty(Hub.prototype, `on${method}`, {
    enumerable: true,
    get() {
      return this.last(method);
    },
    set(handler) {
      this.listen(method, handler);
    }
  });
});

const h = new Hub();
console.log(h.LOW, h.HIGH, h.kind, h.size);
h.onopen = (v) => {
  h.fired += 'open:' + v + ' ';
};
h.onmessage = (v) => {
  h.fired += 'msg:' + v + ' ';
};
h.fire('open', 1);
h.fire('message', 'hi');
h.fire('close', 'ignored');
console.log(h.fired, h.size, typeof h.onopen, h.onclose === null);
