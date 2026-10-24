// A module-scope table of methods read with a run-time key (mysql2's makeSelector[selector]()).
'use strict';
const makeSelector = {
  RR() {
    let index = 0;
    return (clusterIds) => clusterIds[index++ % clusterIds.length];
  },
  RANDOM() {
    return (clusterIds) => clusterIds[Math.floor(Math.random() * clusterIds.length)];
  },
  ORDER() {
    return (clusterIds) => clusterIds[0];
  },
};
class NS {
  constructor(selector) { this._selector = makeSelector[selector](); }
  pick(ids) { return this._selector(ids); }
}
function of(selector, def) {
  selector = (selector || def).toUpperCase();
  if (!makeSelector[selector]) selector = def;
  return new NS(selector);
}
const rr = of('rr', 'ORDER'), ord = of('order', 'RR'), unk = of('zzz', 'ORDER');
const ids = ['a', 'b', 'c'];
console.log(rr.pick(ids), rr.pick(ids), rr.pick(ids), rr.pick(ids), ord.pick(ids), unk.pick(ids));
// A table that carries a description comment (JSDoc without @type) is still untyped.
/**
 * Second selector table
 */
const makeSecond = {
  RR() { let i = 0; return (ids) => ids[i++ % ids.length]; },
  ORDER() { return (ids) => ids[0]; },
};
function pickSecond(name, list) { const f = makeSecond[name](); return [f(list), f(list)]; }
console.log(pickSecond('RR', ['a', 'b']), pickSecond('ORDER', ['a', 'b']));
