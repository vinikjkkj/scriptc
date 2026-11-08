// Microtask order, a setTimeout-settled entry, a chained then/finally on a
// Promise.all over a Set of any. Node prints these in the order the event
// loop settles them; the compiled program must interleave identically.
// The 0 ms timer is registered BEFORE the 5 ms one on purpose: Node (and the compiled runtime) stamp every timer with a fresh clock read at its own
// setTimeout call, so with the 5 ms timer first, any pause of 4 ms or more between the two calls (a loaded runner, a sanitizer) puts it ahead of
// the 0 ms one and prints "timeout0" last, in Node as much as in the binary. Registering the 0 ms timer first makes its expiry the earlier one
// whatever the pause.
setTimeout(() => console.log("timeout0"), 0);
function delay(v) { return new Promise((res) => setTimeout(() => res(v), 5)); }
const s = new Set();
s.add(Promise.resolve(1));
s.add(delay("late"));
s.add(Promise.resolve(3));
Promise.resolve().then(() => console.log("micro A"));
const all = Promise.all(s);
all.then((v) => { console.log("all", v.length, v[0], v[1], v[2]); return v; })
  .then((v) => console.log("chained", v[1]))
  .finally(() => console.log("finally"));
Promise.resolve().then(() => console.log("micro B"));
console.log("sync end");
