'use strict';
const log = [];
class Q { constructor() { this.w = 4; } }
function tag(x) { log.push(x); return x; }
function none() { return 'n'; }
function one(x) { return 'one ' + x; }
// await as a surplus argument inside an async function
async function asyncMain() {
  const p = Promise.resolve(7);
  console.log(none(await p), log.length);
  console.log(one(1, await Promise.resolve(tag('aw'))), log.length);
  const r = none(tag('q1'), await tag('aw2'));
  console.log(r, log.join(','));
}
asyncMain().then(() => {
  // receiver with effect, then a zero-param method with surplus
  function getObj() { tag('recv'); return { m() { return 'M'; } }; }
  console.log(getObj().m(tag('sa')), log.join(','));
  // conditional receiver
  const a = { m() { return 'A'; } }, b = { m() { return 'B'; } };
  console.log((log.length % 2 ? a : b).m(tag('sb')));
  // postfix surplus on a member
  const cnt = { n: 3 };
  console.log(none(cnt.n++), cnt.n);
  // surplus inside a surplus call, both zero-param
  console.log(none(none(tag('nest'))), log.length);
  // arrow expression body
  const f = (z) => none(tag('arr'));
  console.log(f(0), log.length);
  // loop condition and ternary
  let k = 0;
  while (none(k++ < 3)) { if (k > 5) break; }
  console.log('k', k);
  // new with a callee expression that has an effect
  function getClass() { tag('gc'); return Q; }
  console.log(new (getClass())(tag('nq')).w, log.join(','));
  // zero-param function value held in a variable
  const h = () => 'h';
  console.log(h(tag('hv')), log.length);
  // surplus after a spread on a fixed-arity callee should still refuse or work; plain args only here
  // derived class super() with surplus into a zero-param base
  class Base { constructor() { this.b = 'b'; } }
  class Der extends Base { constructor() { super(tag('sup')); this.d = 'd'; } }
  const dd = new Der();
  console.log(dd.b + dd.d, log.join(','));
});
