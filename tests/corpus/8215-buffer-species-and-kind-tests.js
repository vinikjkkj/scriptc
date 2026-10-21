// ws's buffer-util: Buffer's species constructor makes views, and toBuffer
// dispatches on Buffer.isBuffer / instanceof ArrayBuffer / ArrayBuffer.isView
// over an untyped value.
const FastBuffer = Buffer[Symbol.species];

/**
 * @param {*} data
 * @returns {Buffer}
 */
function toBuffer(data) {
  if (Buffer.isBuffer(data)) return data;
  let buf;
  if (data instanceof ArrayBuffer) {
    buf = new FastBuffer(data);
  } else if (ArrayBuffer.isView(data)) {
    buf = new FastBuffer(data.buffer, data.byteOffset, data.byteLength);
  } else {
    buf = Buffer.from(data);
  }
  return buf;
}

const b = Buffer.from('hello');
console.log(toBuffer(b) === b, toBuffer('text').toString());
const u8 = new Uint8Array([104, 105]);
console.log(toBuffer(u8).toString(), Buffer.isBuffer(toBuffer(u8)));
console.log(Buffer.isBuffer(u8), Buffer.isBuffer('x'), Buffer.isBuffer(null), ArrayBuffer.isView(u8), ArrayBuffer.isView('x'));
const base = Buffer.from('abcdefgh');
const view = new FastBuffer(base.buffer, base.byteOffset + 2, 3);
console.log(view.toString(), view.length);
