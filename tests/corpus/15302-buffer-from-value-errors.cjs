// The value's error arms: ERR_INVALID_ARG_TYPE for every kind it refuses, ERR_UNKNOWN_ENCODING, and
// the BigInt conversions. Each message and code is Node's.
var bf = Buffer.from
function dv (x) { return x }
function t (name, fn) {
  try { console.log(name, fn().length) } catch (e) { console.log(name, 'THREW', e.name, e.code, e.message) }
}
t('enc-bogus', function () { return bf('ab', 'bogus') })
t('enc-bogus-empty', function () { return bf('', 'bogus') })
t('num', function () { return bf(dv(5)) })
t('bool', function () { return bf(dv(true)) })
t('null', function () { return bf(dv(null)) })
t('undef', function () { return bf(dv(undefined)) })
t('noargs', function () { return bf() })
t('plain-obj', function () { return bf(dv({})) })
t('fn', function () { return bf(dv(function f () {})) })
t('vo-num', function () { return bf(dv({ valueOf: function () { return 5 } })) })
t('vo-self', function () { var o = { valueOf: function () { return this } }; return bf(dv(o)) })
t('tostr-only', function () { return bf(dv({ toString: function () { return 'ab' } })) })
t('typebuf-nodata', function () { return bf(dv({ type: 'Buffer' })) })
t('vo-throws', function () { return bf(dv({ valueOf: function () { throw new Error('boom') } })) })
t('vo-ret-obj', function () { return bf(dv({ valueOf: function () { return { length: 1, 0: 4 } } })) })
t('arr-bigint', function () { return bf(dv([1n])) })
t('i64-err', function () { return bf(dv(new BigInt64Array([1n]))) })
t('u64-empty', function () { return bf(dv(new BigUint64Array([]))) })
t('arrlike-badlen', function () { return bf(dv({ length: '2', 0: 65 })) })
t('arrlike-neg', function () { return bf(dv({ length: -1 })) })
t('buflen-obj', function () { return bf(dv({ type: 'Buffer', data: [1], length: 'x' })) })
t('enc-obj-ignored', function () { return bf(dv('ab'), dv({ toString: function () { return 'hex' } })) })
