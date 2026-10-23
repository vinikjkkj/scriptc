// @exit: 3
// util.deprecate(fn, msg, code?) as pg uses it (client.js, utils.js):
// the wrapper keeps fn's signature, forwards arguments and the result, and
// warns ONCE on its first call (Node: process.emitWarning(msg,
// 'DeprecationWarning', code)); a code already warned under by another
// wrapper stays silent. The default report carries the pid, and the harness compares
// stderr only for exit-0 programs, so the program ends with exit code 3 and
// the @exit directive keeps stderr out of the comparison; the warning event fires
// a tick later in Node, so the transcript reads the listener's log after
// a timer.
'use strict';
const nodeUtils = require('util');

const seen = [];
process.on('warning', (w) => {
  seen.push(`${w.name}|${w.code}|${w.message}`);
});

let calls = 0;
const plain = nodeUtils.deprecate(() => {
  calls++;
}, 'plain is deprecated');
const add = nodeUtils.deprecate((/** @type {number} */ a, /** @type {number} */ b) => a + b, 'add is deprecated', 'DEP_ADD');
const mul = nodeUtils.deprecate((/** @type {number} */ a, /** @type {number} */ b) => a * b, 'mul is deprecated', 'DEP_ADD');
const greet = nodeUtils.deprecate((/** @type {string} */ s) => 'hi ' + s, 'greet is deprecated');

plain();
plain();
console.log(add(2, 3), add(4, 5));
console.log(mul(2, 3));
console.log(greet('a'), greet('b'));
const greet2 = nodeUtils.deprecate((/** @type {string} */ s) => 'yo ' + s, 'greet is deprecated');
console.log(greet2('c'), calls);

setTimeout(() => {
  for (const s of seen) console.log(s);
  console.log('warnings', seen.length);
  process.exitCode = 3;
}, 20);
