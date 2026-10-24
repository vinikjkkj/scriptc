'use strict';
let n = 0;
const plainValue = 'bare';
function localDate(x) { return x * 2 + n; }
module.exports = {
  localDate,
  plain: 'bare',
  _clear() {
    n = 0;
    return 'cleared';
  },
  count() {
    return ++n;
  },
  describe() {
    return 'tbl:' + plainValue;
  },
  'quoted-name'() {
    return 'q' + n;
  },
  async asyncOne() {
    return 'a' + n;
  },
  name: 'tbl',
};
