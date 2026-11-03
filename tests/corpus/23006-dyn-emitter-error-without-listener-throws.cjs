const { EventEmitter } = require('events');
// Printing goes through String() so no dynamic value is inspected: a grafted instance in a dynamic slot is refused
// in a program that inspects dynamic values (tests/diagnostics/grafted-emitter-dyn-reflection-refused.cjs).
const out = (...a) => { process.stdout.write(a.map((v) => String(v)).join(" ") + "\n"); };
function applyMixin(d, m) { Object.getOwnPropertyNames(m.prototype).forEach((name) => { Object.defineProperty(d.prototype, name, Object.getOwnPropertyDescriptor(m.prototype, name)); }); }
class Grafted { constructor() { EventEmitter.call(this); } }
applyMixin(Grafted, EventEmitter);
class Native extends EventEmitter {}

function fail(x, payload) {
  try {
    x.emit('error', payload);
    out('no throw');
  } catch (e) {
    out(typeof e, e instanceof Error, e.code, e.message, e === payload);
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
  out(x.emit('error', 'quiet'), x.emit('error', err), seen.join('|'));
  x.removeAllListeners('error');
  fail(x, err);
}
round(new Native());
round(new Grafted());
round(new EventEmitter());
// emit('error') with no payload at all
function bare(x) { try { x.emit('error'); } catch (e) { out(e.code, e.message); } }
bare(new Native());
bare(new Grafted());
// once-only error listener: the second emit throws
const once = new Native();
once.once('error', () => out('once error'));
once.emit('error', new Error('first'));
try { once.emit('error', new Error('second')); } catch (e) { out('second threw', e.message); }
