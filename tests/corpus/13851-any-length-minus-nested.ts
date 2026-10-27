// `-=` and `--` on the length of an any-typed array reached through a nested member:
// the receiver `h.list` is evaluated once, the write truncates, and the value is the new length.
const h: any = { list: [10, 20, 30, 40, 50] };
h.list.length -= 2;
console.log(h.list.length, JSON.stringify(h.list));
const after = (h.list.length -= 1);
console.log(after, h.list.length, JSON.stringify(h.list));
h.list.length--;
console.log(h.list.length, JSON.stringify(h.list));
let calls = 0;
const pick = (): any => {
  calls++;
  return h;
};
pick().list.length -= 1;
console.log(calls, h.list.length, JSON.stringify(h.list));
