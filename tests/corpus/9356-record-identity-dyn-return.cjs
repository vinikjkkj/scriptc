'use strict';
// A record that goes into an array (a dynamic element slot) and comes back out must be the same object, through a plain read, through a function returning the stored value, and through a function returning either the stored value or a fresh record.
const store = [];
function save(r) { store.push(r); return r; }
function fetch() { return store[0]; }
const made = save({ len: 2, name: 'buf' });
const back = fetch();
console.log(back === made, back.len, back.name);
function either(flag) { return flag ? store[0] : { len: 0, name: 'fresh' }; }
const pick = either(true);
console.log(pick === made, either(true) === made, either(false).len);
