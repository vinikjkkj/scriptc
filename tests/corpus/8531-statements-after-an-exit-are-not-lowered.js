// Code that follows a statement which always exits never runs, so a construct the
// compiler has no lowering for there (Object.defineProperty here) is not a
// refusal.
'use strict';
function after(n) {
  if (n > 0) return 'pos';
  else return 'neg';
  Object.defineProperty({}, 'x', { value: 1 });
}
function plain() {
  return 'plain';
  Object.defineProperties({}, { y: { value: 2 } });
}
function thrower() {
  throw new Error('stop');
  Object.defineProperty({}, 'w', { value: 4 });
}
console.log(after(1), after(-1), plain());
try {
  thrower();
} catch (e) {
  console.log(e.message);
}
