'use strict';
// A memo kept on a plain object's own property (an expando written from a function): the first call builds a record and stores it; later calls return the stored value, which must be that same object.
const holder = {};
function memoRecord() {
  if (holder.buf) return holder.buf;
  const res = { len: 2, noop: function () {} };
  holder.buf = res;
  return res;
}
const b = memoRecord();
console.log(memoRecord() === b, holder.buf === b, b.len);
