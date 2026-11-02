const { EventEmitter } = require('events');
class Hub extends EventEmitter {}

function viaApply(target, args) { return target.emit.apply(target, args); }
function viaSpread(target, ...args) { return target.emit(...args); }
function viaCall(target, name, a, b) { return target.emit.call(target, name, a, b); }
function viaIndex(target, name, a, b, c) { return target['emit'](name, a, b, c); }

const hub = new Hub();
hub.on('sum', (a, b, c) => console.log('sum', a + b + (c === undefined ? 0 : c)));
hub.on('echo', function () { console.log('echo', arguments.length, [].slice.call(arguments).join('|')); });
console.log(viaApply(hub, ['sum', 1, 2, 3]), viaApply(hub, ['sum', 4, 5]), viaApply(hub, ['absent']));
console.log(viaSpread(hub, 'echo', 'a', 'b', 'c', 'd'), viaSpread(hub, 'echo'));
console.log(viaCall(hub, 'sum', 10, 20), viaIndex(hub, 'sum', 7, 8, 9));
const names = ['sum', 'echo'];
for (const n of names) console.log(n, hub.listenerCount(n));

// listeners added and removed while an emit is running: Node dispatches over a snapshot
const order = [];
function a() { order.push('a'); hub.off('mut', b); hub.on('mut', late); }
function b() { order.push('b'); }
function c() { order.push('c'); }
function late() { order.push('late'); }
hub.on('mut', a);
hub.on('mut', b);
hub.on('mut', c);
viaSpread(hub, 'mut');
console.log(order.join(','), hub.listenerCount('mut'));
order.length = 0;
viaSpread(hub, 'mut');
console.log(order.join(','));

// once and prepend through the dyn surface
const log = [];
hub.once('o', () => log.push('once1'));
hub.prependListener('o', () => log.push('first'));
hub.prependOnceListener('o', () => log.push('first-once'));
viaSpread(hub, 'o');
viaSpread(hub, 'o');
console.log(log.join(','), hub.listenerCount('o'));

// a throwing listener stops the pass; the exception reaches the caller of emit
const t = new Hub();
t.on('boom', () => { throw new Error('listener threw'); });
t.on('boom', () => console.log('not reached'));
try { viaSpread(t, 'boom'); } catch (e) { console.log('caught', e.message); }
// removeListener meta events through the dyn surface
const m = new Hub();
const seen = [];
m.on('removeListener', (name) => seen.push('rm:' + name));
m.on('newListener', (name) => seen.push('new:' + name));
const f = () => {};
m.on('k', f);
m.off('k', f);
console.log(seen.join(','));
