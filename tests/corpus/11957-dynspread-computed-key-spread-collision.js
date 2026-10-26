// A RUN-TIME key ahead of a spread whose source carries the same key: the spread's value wins and keeps the key's position (the first write), and an integer-like source key sorts first in Node's own-key order.
function pick(name) {
  return JSON.parse('{"z":9,"' + name + '":"from-src","2":"idx"}');
}
function make(key, src) {
  const o = { [key]: 1, ...src };
  return o;
}
const a = make("q", pick("q"));
console.log(Object.keys(a).join(","), JSON.stringify(a));
const b = make("z", pick("q"));
console.log(Object.keys(b).join(","), JSON.stringify(b));
const c = make("k" + "1", { k1: "lit", w: 0 });
console.log(Object.keys(c).join(","), JSON.stringify(c), c.k1);
