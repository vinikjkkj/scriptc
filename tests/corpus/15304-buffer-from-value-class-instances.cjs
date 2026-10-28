// Class instances through the stored Buffer.from value: valueOf answers a string, an array, a Buffer,
// a number, or an object; a method reads `this`; a plain instance and a toString-only instance take
// the refusal; an array holding instances converts each element with ToNumber.
var bf = Buffer.from
function dv (x) { return x }
function hx (b) { return b.length + ':' + b.toString('hex') }
function t (name, fn) {
  try { console.log(name, hx(fn())) } catch (e) { console.log(name, 'THREW', e.name, e.code, e.message) }
}
class VS { constructor () { this.s = 'yo' } valueOf () { return this.s } }
class VA { valueOf () { return [65, 66] } }
class VB { valueOf () { return Buffer.from('bb') } }
class VN { valueOf () { return 5 } }
class VO { valueOf () { return {} } }
class Plain { constructor () { this.x = 1 } }
class TS { toString () { return 'ts' } }
t('vs-this', function () { return bf(dv(new VS())) })
t('va-arr', function () { return bf(dv(new VA())) })
t('vb-buf', function () { return bf(dv(new VB())) })
t('vn-num', function () { return bf(dv(new VN())) })
t('vo-obj', function () { return bf(dv(new VO())) })
t('plain', function () { return bf(dv(new Plain())) })
t('ts-only', function () { return bf(dv(new TS())) })
t('inst-in-arr', function () { return bf(dv([new Plain()])) })
t('valueof-in-arr', function () { return bf(dv([new VA(), new VS()])) })
t('obj-this', function () { var o = { s: 'hi', valueOf: function () { return this.s } }; return bf(dv(o)) })
