// The direct Buffer.from call with an untyped operand takes the same runtime path as the stored
// value: array-likes, {type:'Buffer'}, valueOf answers, string and boolean array elements, a class
// instance, a run-time encoding. The statically typed forms (a string with an encoding, a number
// array, a Uint8Array) keep their own lowering and answer as before.
function dv (x) { return x }
function ev (x) { return x }
function t (name, fn) {
  try { console.log(name, fn().toString('hex')) } catch (e) { console.log(name, 'THREW', e.name, e.code) }
}
class Plain { constructor () { this.x = 1 } }
class VA { valueOf () { return [65, 66] } }
t('d-arrlike', function () { return Buffer.from(dv({ length: 2, 0: 65, 1: 66 })) })
t('d-typebuf', function () { return Buffer.from(dv({ type: 'Buffer', data: [1, 2] })) })
t('d-valueof', function () { return Buffer.from(dv({ valueOf: function () { return 'hi' } })) })
t('d-arr-str', function () { return Buffer.from(dv(['7', 9])) })
t('d-arr-bool', function () { return Buffer.from(dv([true, null])) })
t('d-arr-mixed', function () { return Buffer.from(dv([1, '2', false, undefined, 300])) })
t('d-inst-valueof', function () { return Buffer.from(dv(new VA())) })
t('d-inst-plain', function () { return Buffer.from(dv(new Plain())) })
t('d-date-len', function () { return Buffer.from(dv(new Date(NaN))) })
t('d-enc-hex', function () { return Buffer.from(dv('6869'), ev('hex')) })
t('d-enc-bogus', function () { return Buffer.from(dv('ab'), ev('bogus')) })
t('d-enc-num', function () { return Buffer.from(dv('ab'), ev(5)) })
t('s-hex', function () { return Buffer.from('6869', 'hex') })
t('s-num-array', function () { return Buffer.from([1, 2, 256]) })
t('s-u8', function () { return Buffer.from(new Uint8Array([9, 8])) })
