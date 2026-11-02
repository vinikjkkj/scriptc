const { EventEmitter } = require('events');
function applyMixin(d, m) { Object.getOwnPropertyNames(m.prototype).forEach((name) => { Object.defineProperty(d.prototype, name, Object.getOwnPropertyDescriptor(m.prototype, name)); }); }
class Grafted { constructor() { this.id = 'g'; EventEmitter.call(this); } own() { return 'own'; } }
applyMixin(Grafted, EventEmitter);
class Native extends EventEmitter { constructor() { super(); this.id = 'n'; } own() { return 'own'; } }

const NAMES = ['on', 'once', 'off', 'emit', 'addListener', 'removeListener', 'removeAllListeners',
  'prependListener', 'prependOnceListener', 'listenerCount', 'listeners', 'rawListeners', 'eventNames',
  'setMaxListeners', 'getMaxListeners'];
function report(x) {
  const out = [];
  for (const k of NAMES) out.push(typeof x[k]);
  return out.join(',');
}
const g = new Grafted(), n = new Native(), b = new EventEmitter();
console.log(report(g));
console.log(report(n));
console.log(report(b));
function same(x, y, k) { return x[k] === y[k]; }
console.log(NAMES.map((k) => same(g, n, k) + '/' + same(n, b, k) + '/' + same(g, g, k)).join(' '));
function probe(x) { return [x instanceof EventEmitter, x instanceof Grafted, x instanceof Native, 'emit' in x, 'own' in x, 'nope' in x, typeof x.own, typeof x.nope, x.nope, x.id].join(' '); }
console.log(probe(g));
console.log(probe(n));
console.log(probe(b));
// bound and unbound reads of members
function unbound(x) { const f = x.listenerCount; return f.call(x, 'q'); }
function bound(x) { const f = x.getMaxListeners.bind(x); return f(); }
console.log(unbound(g), unbound(n), bound(g), bound(n));
// the member as a value keeps its name
function fname(x, k) { return x[k].name; }
console.log(fname(g, 'emit'), fname(n, 'on'), fname(b, 'listenerCount'));
// chaining answers the receiver itself
function chain(x) { return x.on('a', () => {}) === x && x.once('a', () => {}) === x && x.off('a', () => {}) === x && x.setMaxListeners(5) === x && x.removeAllListeners() === x; }
console.log(chain(g), chain(n), chain(b));
