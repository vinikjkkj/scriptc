import { EventEmitter } from 'node:events';

class Command extends EventEmitter {
  fail(err) {
    this.emit('error', err);
  }
}

const seen = [];
const cmd = new Command();
cmd.on('error', (e) => seen.push(e.message));
const fire = (err) => cmd.fail(err);
fire(new Error('first'));
fire(new TypeError('second'));
console.log(seen.join('|'));

const bare = new Command();
try {
  bare.fail(new Error('unhandled'));
} catch (e) {
  console.log('thrown', e.message);
}
