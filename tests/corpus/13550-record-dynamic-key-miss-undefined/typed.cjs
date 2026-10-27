'use strict';
const Types = require('./types.cjs');
const INTEGER_BYTES = {
  [Types.TINY]: 1,
  [Types.SHORT]: 2,
  [Types.LONG]: 4,
  [Types.LONGLONG]: 8,
};
const HINT_UPGRADABLE = new Set([Types.TINY, Types.SHORT, Types.LONG]);
function integerHint(value, type) {
  const bytes = INTEGER_BYTES[type];
  if (!bytes || !HINT_UPGRADABLE.has(type)) return null;
  return bytes * 10;
}
function encoderFor(type) {
  if (INTEGER_BYTES[type]) return 'int' + INTEGER_BYTES[type];
  return 'other';
}
module.exports = { integerHint, encoderFor };
