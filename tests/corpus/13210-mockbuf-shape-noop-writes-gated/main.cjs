'use strict';
// The mysql2 MockBuffer shape: a for-in over Buffer.prototype installs an own noop on each function key of ONE buffer. Calls on that buffer then answer undefined, its length stays native, and a sibling buffer keeps the native methods.
function mockBuffer() {
  const noop = function () {};
  const res = Buffer.alloc(0);
  for (const op in Buffer.prototype) {
    if (typeof res[op] === 'function') res[op] = noop;
  }
  return res;
}
const m = mockBuffer();
console.log(m.length);
console.log(m.readUInt8(0) === undefined);
console.log(m.writeUInt8(5, 0) === undefined);
console.log('readUInt8' in m);
const real = Buffer.alloc(3);
console.log(real.readUInt8(0), real.length);
