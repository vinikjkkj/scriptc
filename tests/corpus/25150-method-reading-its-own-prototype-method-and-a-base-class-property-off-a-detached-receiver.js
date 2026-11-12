// A method that returns its own prototype method as the next step and reads a property the base
// class never declares (only a sibling subclass sets it), and that a sibling class borrows
// (`ChangeUser.prototype.handshakeResult = ClientHandshake.prototype.handshakeResult`): the detached
// variant of the method cannot be built over a raw receiver while the self-reference is already
// committed to its name.
import EventEmitter from 'node:events';

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

  fail(err) {
    if (this.onResult) {
      this.onResult(err);
    }
  }
}

class ChangeUser extends Command {
  constructor(callback) {
    super();
    this.onResult = callback;
  }
}

class ClientHandshake extends Command {
  handshake(code) {
    this.last = code;
    return ClientHandshake.prototype.handshakeResult;
  }

  handshakeResult(code) {
    if (code === 0) {
      return ClientHandshake.prototype.handshakeResult;
    }
    if (this.onResult) {
      this.onResult(code);
    } else {
      this.emit('fail', code);
    }
    return null;
  }
}

ChangeUser.prototype.handshakeResult = ClientHandshake.prototype.handshakeResult;

const seen = [];
console.log(new ChangeUser(null).stateName());
const c = new ChangeUser((e) => seen.push('cb' + e));
c.fail(3);
console.log(c.handshakeResult(4), seen.join(","));
const h = new ClientHandshake();
h.on('fail', (e) => seen.push('e' + e));
const next = h.handshake(5);
console.log(next === ClientHandshake.prototype.handshakeResult);
console.log(next.call(h, 7), seen.join(","));
console.log(h.handshakeResult(0) === ClientHandshake.prototype.handshakeResult);
