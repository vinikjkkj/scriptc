'use strict';
// A const require() binding read as a WHOLE value: destructured, typeof'd, spread, and passed on.
const helpers = require('./helpers.cjs');
const { escapeField, size } = helpers;
console.log(escapeField('a'), size(), size(4));
const { label: lab, size: sz } = helpers;
console.log(lab, typeof sz, sz(1));
console.log(typeof helpers, typeof helpers.escapeField, typeof helpers.label);
function describe(mod) { return typeof mod + ':' + mod.label; }
console.log(describe(helpers));
console.log(helpers.size(5), helpers.escapeField('b'));
