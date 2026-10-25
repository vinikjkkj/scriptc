'use strict';
// A plain object whose own `on` method is a user function: an untyped
// receiver calls that method with the object as `this`, as Node does.
function sub(src) {
  const r = src.on('topic', 42);
  console.log('returned', r);
  console.log('name', src.name);
}
const o = {
  name: 'obj',
  on(name, v) { console.log('own on', name, v, this.name); return 'chained'; },
};
sub(o);
