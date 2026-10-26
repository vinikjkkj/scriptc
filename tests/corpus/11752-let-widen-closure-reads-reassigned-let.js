// A closure captures a let that is written a number and then a string: the
// closure's read must follow the value at call time, not the first type.
let v = 0;
const kind = () => (typeof v === 'string' ? 'str:' + v.length : 'num:' + (v + 1));
console.log(kind());
v = 'hello';
console.log(kind());
v = 7;
console.log(kind(), v + 1);
function makeReader() {
  let slot = 10;
  return {
    set(next) { slot = next; },
    show() { return typeof slot === 'string' ? slot.toUpperCase() : slot * 3; },
  };
}
const r = makeReader();
console.log(r.show());
r.set('abc');
console.log(r.show());
r.set(4);
console.log(r.show());
