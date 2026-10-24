'use strict';
let reads = 0;
const inner = { sides: 4 };
exports.plain = 'bare';
exports.__defineGetter__('Count', () => ++reads);
exports.__defineGetter__('Label', function () {
  return 'label' + reads;
});
Object.defineProperty(exports, 'Shape', {
  enumerable: true,
  configurable: true,
  get: function () {
    return inner;
  },
});
Object.defineProperty(exports, 'Tail', { enumerable: true, get: () => 'tail' + (reads * 10) });
exports.counter = () => reads;
