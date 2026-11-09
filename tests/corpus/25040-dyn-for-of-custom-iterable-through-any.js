function mk(a) {
  let i = 0;
  return { next(v) { return i < 2 ? { value: a + i++, done: false } : { value: undefined, done: true }; }, [Symbol.iterator]() { return this; } };
}
function use(o) {
  const out = [];
  for (const v of o) out.push(v);
  console.log(out.join(","));
  console.log([...mk(5)].join(","));
  console.log(Array.from(mk(7)).join(","));
}
use(mk(3));
