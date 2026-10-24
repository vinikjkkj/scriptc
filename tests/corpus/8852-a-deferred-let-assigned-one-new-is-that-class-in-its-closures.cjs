'use strict';
// `let v;` assigned one `new` and read by closures created after it: the closures see the class
// instance (tsc alone calls the binding any), through a namespace-style callee and a plain one.
const EventEmitter = require('events').EventEmitter;
class Cmd extends EventEmitter {
  constructor(flags) { super(); this.flags = flags; this.handshake = null; }
  run() { this.handshake = { connectionId: 7 }; this.emit('end'); }
}
const Commands = { ClientHandshake: Cmd };
class Plain { constructor(n) { this.n = n; this.log = []; } bump() { this.n++; return this.n; } }
class Conn extends EventEmitter {
  constructor(cfg) {
    super();
    this.config = cfg;
    this.threadId = 0;
    this._fatal = null;
    this._packet = null;
    let handshakeCommand;
    if (!this.config.isServer) {
      handshakeCommand = new Commands.ClientHandshake(this.config.flags);
      handshakeCommand.on('end', () => {
        if (!handshakeCommand.handshake || this._fatal) return;
        this._packet = handshakeCommand.handshake;
        this.threadId = handshakeCommand.handshake.connectionId;
        this.emit('connect', handshakeCommand.handshake);
      });
      setImmediate(() => handshakeCommand.run());
    }
  }
}
function counter() {
  let p;
  p = new Plain(10);
  const inc = () => p.bump() + p.n;
  const peek = function () { return p.log.length + p.n; };
  return [inc, peek];
}
const c = new Conn({ isServer: false, flags: 3 });
c.on('connect', (h) => console.log('connected', h.connectionId, c.threadId, c._packet.connectionId));
const [inc, peek] = counter();
console.log(inc(), peek(), inc());
