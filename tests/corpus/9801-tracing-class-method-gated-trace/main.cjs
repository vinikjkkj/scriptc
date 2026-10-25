const { tracePromise, connectChannel, shouldTrace } = require('./tr.cjs');
const EventEmitter = require('events');
class Conn extends EventEmitter {
  constructor(cfg) { super(); this.config = cfg; this.n = 0; }
  connect() {
    if (shouldTrace(connectChannel)) {
      const config = this.config;
      tracePromise(connectChannel, () => new Promise((resolve) => { this.once('connect', resolve); this.emit('connect', 5); }), () => ({ host: config.host }))
        .then((v) => console.log('connected', v));
    }
  }
}
const c = new Conn({ host: 'h' });
c.connect();
const ch = require('./tr.cjs').connectChannel;
ch.start.subscribe((m) => console.log('start', JSON.stringify(m)));
c.connect();
