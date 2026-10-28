// Promise.all over a Set of any-typed promises (JS: `new Set()` is Set<any>):
// awaited inside an async function, discarded, and bound with a then callback.
// The combined payload is the checked-dynamic array; Node settles each entry
// in its own turn and the then callbacks run after the awaits above them.
const s = new Set();
s.add(Promise.resolve(1));
s.add(Promise.resolve("x"));
async function awaitAll() {
  const r = await Promise.all(s);
  console.log("await-all", r.length, r[0], r[1]);
}
awaitAll();

const t = new Set();
t.add(Promise.resolve(1));
t.add(Promise.resolve(2));
Promise.all(t).then(() => console.log("discarded-ish"));
Promise.all(t);

const u = new Set();
u.add(Promise.resolve(3));
u.add(Promise.resolve(4));
Promise.all(u).then((v) => console.log("set js", v.length, v[1]));
console.log("sync end");
