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
  src.emit('known', 5);
  src.removeListener(name, g);
  console.log('after remove', src.listenerCount(name));
  src.emit('known', 6);
}
track(c, 'phantom');
track(c, 'known');
console.log('final', c.listenerCount('phantom'), c.listenerCount('known'));
