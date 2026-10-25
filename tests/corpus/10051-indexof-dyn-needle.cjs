'use strict';
// indexOf/includes over static arrays with an untyped (any) needle:
// strict equality element by element, so NaN never matches, -0 matches 0,
// and a missing value answers -1 / false.
function idx(xs, v) { return xs.indexOf(v); }
function inc(xs, v) { return xs.includes(v); }
function eventIndex(names, eventName) {
  return names.indexOf(eventName) >= 0;
}
const names = ['data', 'end', 'error'];
console.log(idx(names, 'end'), idx(names, 'nope'), idx(names, 'error'));
console.log(inc(names, 'data'), inc(names, 'x'), eventIndex(names, 'end'), eventIndex(names, 'close'));
console.log(idx([1, 2, 3], 2), idx([0, NaN], NaN), idx([-0], 0), idx([0], -0));
console.log(inc([1, 2], 3), inc([NaN], NaN), inc([true, false], false), inc(['1'], 1));
const dup = ['a', 'b', 'a'];
console.log(idx(dup, 'a'), inc(dup, 'c'));
