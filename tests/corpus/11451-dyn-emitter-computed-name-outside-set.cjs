'use strict';
// A computed name that the program never spells: the registration is
// counted, removed and never fired, exactly as Node keeps it.
const EventEmitter = require('events');
const c = new EventEmitter();
c.on('known', function (a) { console.log('known', a); });
function track(src, name) {
  const g = function (a) { console.log('ghost', name, a); };
  src.on(name, g);
  console.log('after on', src.listenerCount(name), src.listenerCount('known'));
  return g;
}
function untrack(src, name, g) {
  src.removeListener(name, g);
  console.log('after remove', src.listenerCount(name));
}
const g1 = track(c, 'phantom');
c.emit('known', 5);
untrack(c, 'phantom', g1);
c.emit('known', 6);
const g2 = track(c, 'known');
c.emit('known', 7);
untrack(c, 'known', g2);
console.log('final', c.listenerCount('phantom'), c.listenerCount('known'));
