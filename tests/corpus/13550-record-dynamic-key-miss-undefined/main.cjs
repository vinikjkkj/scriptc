'use strict';
const typed = require('./typed.cjs');
const Types = require('./types.cjs');
console.log(typed.integerHint(1, 1), typed.integerHint(1, 2), typed.integerHint(1, 8));
console.log(typed.integerHint(1, '1'), typed.integerHint(1, 99), typed.integerHint(1, '3'));
console.log(typed.encoderFor(Types.SHORT), typed.encoderFor(Types.LONGLONG), typed.encoderFor(7));
const raw = JSON.parse('[1,"2"]');
console.log(typed.encoderFor(raw[0]), typed.encoderFor(raw[1]), typed.encoderFor(undefined));
// A computed numeric key on a record with no index signature: the key is
// ToPropertyKey'd at runtime, and a miss answers undefined.
const sizes = { [Types.TINY]: 1, [Types.LONG]: 4 };
// JSON.parse answers an untyped (checked-dynamic) array: its keys are dynamic.
const picks = JSON.parse('[1, 3, 2, "3", "1", null, "x"]');
for (const p of picks) {
  const v = sizes[p];
  console.log(typeof p, String(p), v === undefined ? 'miss' : 'hit ' + v, !v);
}
