const { EventEmitter } = require('events');
function applyMixin(d, m) { Object.getOwnPropertyNames(m.prototype).forEach((name) => { Object.defineProperty(d.prototype, name, Object.getOwnPropertyDescriptor(m.prototype, name)); }); }
class Grafted { constructor() { EventEmitter.call(this); } }
applyMixin(Grafted, EventEmitter);
class Native extends EventEmitter {}

function fail(x, payload) {
  try {
    x.emit('error', payload);
    console.log('no throw');
  } catch (e) {
    console.log(typeof e, e instanceof Error, e.code, JSON.stringify(e.message), e === payload);
  }
}
function round(x) {
  const err = new Error('boom');
  fail(x, err);
  fail(x, 'a string');
  fail(x, 42);
  fail(x, { a: 1, b: [1, 2] });
  fail(x, undefined);
  fail(x, null);
  // an 'error' listener makes it an ordinary event
  const seen = [];
  x.on('error', (e) => seen.push(String(e)));
  console.log(x.emit('error', 'quiet'), x.emit('error', err), seen.join('|'));
  x.removeAllListeners('error');
  fail(x, err);
}
round(new Native());
round(new Grafted());
round(new EventEmitter());
// emit('error') with no payload at all
function bare(x) { try { x.emit('error'); } catch (e) { console.log(e.code, e.message); } }
bare(new Native());
bare(new Grafted());
// once-only error listener: the second emit throws
const once = new Native();
once.once('error', () => console.log('once error'));
once.emit('error', new Error('first'));
try { once.emit('error', new Error('second')); } catch (e) { console.log('second threw', e.message); }
