class ErrA extends Error {
  constructor(msg, cause) { super(msg, { cause }); }
}
function wrap(e) { return new ErrA('wrapped: ' + e.message, e); }
const w = wrap(new Error('inner'));
console.log(w.message, w.cause.message);
function mk(m) { return new Error(m); }
console.log(JSON.stringify(mk(undefined).message), mk(null).message, mk(12).message, mk({ toString() { return 'custom'; } }).message, mk('s').message);
try { mk({ toString() { throw new RangeError('boom'); } }); } catch (e) { console.log('caught', e.name, e.message); }
