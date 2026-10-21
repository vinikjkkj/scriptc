import { EventEmitter } from 'node:events';

class Conn extends EventEmitter {
  connect(cb) {
    let onError;
    let onConnect;
    onError = (err) => {
      this.removeListener('connect', onConnect);
      cb(err);
    };
    onConnect = (param) => {
      this.removeListener('error', onError);
      cb(null, param);
    };
    this.once('error', onError);
    this.once('connect', onConnect);
  }

  ready(value) {
    this.emit('connect', value);
  }

  broken(err) {
    this.emit('error', err);
  }
}

const a = new Conn();
a.connect((err, param) => console.log('a', err === null ? 'ok' : err.message, param));
a.ready('handshake');
console.log(a.listenerCount('error'), a.listenerCount('connect'));

const b = new Conn();
b.connect((err, param) => console.log('b', err === null ? 'ok' : err.message, param));
b.broken(new Error('refused'));
console.log(b.listenerCount('error'), b.listenerCount('connect'));
