'use strict';
const log = [];
function tag(x) { log.push(x); return x; }
function none() { return 'n'; }
class Base {
  m() { return 'bm'; }
  static s() { return 'bs'; }
}
class Kid extends Base {
  m() { return 'km'; }
  go() { return this.m(tag('this-m')) + super.m(tag('super-m')) + Kid.s(tag('static')); }
  static s() { return 'ks'; }
  constructor() { super(); this.h = () => 'hh'; }
  call() { return this.h(tag('field-fn')); }
}
const kd = new Kid();
console.log(kd.go(), log.join(','));
console.log(kd.call(), log.length);
// conditions, throw, template, object literal, for-init
if (none(tag('cond'))) console.log('yes'); else console.log('no');
const tpl = `t=${none(tag('tpl'))}`;
const ob = { a: none(tag('obj')) };
console.log(tpl, ob.a, log.length);
for (none(tag('init')); log.length < 0;) { }
let w = 0;
for (let j = 0; j < 2; none(tag('upd')), j++) w++;
console.log('w', w, log.length);
try { throw new Error(none(tag('thr'))); } catch (e) { console.log(e.message, log.length); }
// optional call with surplus
const oc = { m() { return 'oc'; } };
console.log(oc?.m(tag('opt')), log.length);
// surplus into a function value with more params than args
const fv = (a, b) => a + b;
console.log(fv(1, 2, tag('fvs')), log.length);
// surplus with a closure surplus (effect-free, dropped) and a literal
console.log(none(() => 1, 5), log.length);
