'use strict';
// A CommonJS table whose keys are QUOTED (not bare identifiers): numeric-string keys
// with string values, a quoted identifier key with an object value, and bare keys beside them.
module.exports = {
  '437': 'cp437',
  '28605': 'iso885915',
  'win874': 'windows874',
  'windows874': {
    type: '_sbcs',
    chars: 'abc',
  },
  "ascii": { type: '_sbcs', chars: 'xyz' },
  plain: 'bare',
};
