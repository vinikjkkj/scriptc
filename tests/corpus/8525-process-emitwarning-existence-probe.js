// @ts-nocheck
// pg-connection-string guards its one-time warning with a feature probe:
// `!fn.warned && typeof process !== 'undefined' && process.emitWarning`.
// The probe is a function value (truthy) and the guard flag is a function expando.
'use strict';
function noteOnce(text) {
  if (!noteOnce.warned && typeof process !== 'undefined' && process.emitWarning) {
    noteOnce.warned = true;
    return 'would warn: ' + text;
  }
  return 'quiet';
}
noteOnce.warned = false;
console.log(noteOnce('a'), noteOnce('b'));
console.log(Boolean(process.emitWarning && 1), !process.emitWarning);
