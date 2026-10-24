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
