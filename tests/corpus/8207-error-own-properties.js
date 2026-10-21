// Properties programs hang off error objects: mysql2's protocol errors
// (fatal, errno, sqlState, code) and ws's frame errors (code, statusCode).
/**
 * @param {string} message
 * @param {string} [code]
 */
function protocolError(message, code) {
  const err = new Error(message);
  err.code = code || 'PROTOCOL_ERROR';
  err.fatal = true;
  err.errno = 1064;
  err.sqlState = '42000';
  return err;
}

try {
  throw protocolError('bad packet');
} catch (e) {
  console.log(e.message, e.code, e.fatal, e.errno, e.sqlState, e instanceof Error);
}

const e2 = protocolError('with code', 'E_CUSTOM');
console.log(e2.code, e2.fatal, e2.missing);
e2.fatal = false;
e2.extra = { depth: 2, tags: ['a', 'b'] };
console.log(e2.fatal, e2.extra.depth, e2.extra.tags.join('+'));

class WireError extends Error {
  /** @param {string} message */
  constructor(message) {
    super(message);
    this.name = 'WireError';
  }
}
const w = new WireError('wire');
w.statusCode = 1009;
console.log(w.name, w.message, w.statusCode, w instanceof WireError, w instanceof Error);

const r = new RangeError('range');
r.code = 'WS_ERR_X';
console.log(r.code, r instanceof RangeError, String(r.stack).split('\n')[0]);
r.stack = 'custom stack';
console.log(r.stack);

// the same error object reached through an untyped parameter sees the
// properties, and writes made there are seen back by the typed side
/** @param {any} err */
function inspectIt(err) {
  err.seen = (err.seen || 0) + 1;
  return err.errno;
}
console.log(inspectIt(e2), inspectIt(e2), e2.seen);
