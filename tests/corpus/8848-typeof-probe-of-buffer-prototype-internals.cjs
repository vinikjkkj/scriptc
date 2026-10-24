// mysql2's probe of Node's undocumented Buffer fast paths: the code falls back where they are missing, and the
// decoded text is the same either way (the probe values themselves are not printed).
'use strict';
const hasFastSlices =
  typeof Buffer.prototype.utf8Slice === 'function' &&
  typeof Buffer.prototype.latin1Slice === 'function' &&
  typeof Buffer.prototype.asciiSlice === 'function';
exports.hasFastUtf8Write = typeof Buffer.prototype.utf8Write === 'function';
function decode(b, s, e) {
  if (hasFastSlices) return b.utf8Slice(s, e);
  return b.toString('utf8', s, e);
}
console.log(decode(Buffer.from('héllo'), 0, 3), typeof Buffer.prototype.toString, typeof Buffer.prototype.slice);
