// Microtask order, a setTimeout-settled entry, a chained then/finally on a
// Promise.all over a Set of any. Node prints these in the order the event
// loop settles them; the compiled program must interleave identically.
function delay(v) { return new Promise((res) => setTimeout(() => res(v), 5)); }
const s = new Set();
s.add(Promise.resolve(1));
s.add(delay("late"));
s.add(Promise.resolve(3));
setTimeout(() => console.log("timeout0"), 0);
Promise.resolve().then(() => console.log("micro A"));
const all = Promise.all(s);
all.then((v) => { console.log("all", v.length, v[0], v[1], v[2]); return v; })
  .then((v) => console.log("chained", v[1]))
  .finally(() => console.log("finally"));
Promise.resolve().then(() => console.log("micro B"));
console.log("sync end");
