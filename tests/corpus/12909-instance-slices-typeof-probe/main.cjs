// mysql2's fast-path probe (corpus 8848's shape) and the instance spellings it selects.
var hasFastSlices =
  typeof Buffer.prototype.utf8Slice === 'function' &&
  typeof Buffer.prototype.latin1Slice === 'function' &&
  typeof Buffer.prototype.asciiSlice === 'function';
function decode(b, s, e) {
  if (hasFastSlices) return b.utf8Slice(s, e);
  return b.toString('utf8', s, e);
}
console.log(decode(Buffer.from('héllo'), 0, 3), hasFastSlices, typeof Buffer.prototype.write, typeof Buffer.prototype.parent)
console.log(typeof Buffer.prototype.utf8Write, typeof Buffer.prototype.equals, typeof Buffer.prototype.readBigInt64LE)
