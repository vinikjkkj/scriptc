// pg's Query constructor asks `process.domain && config.callback` on every
// construction; in a process that never loaded the domain module the slot reads
// null and the branch (which binds the callback to the domain) is dead.
'use strict';
function Query(config) {
  this.callback = config.callback;
  if (process.domain && config.callback) {
    this.callback = process.domain.bind(config.callback);
  }
}
const q = new Query({ callback: () => 'cb' });
console.log(typeof process.domain, process.domain === undefined, q.callback());
console.log(Boolean(process.domain), process.domain || 'none');
