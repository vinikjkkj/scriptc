// A generic Map whose keys are the instance's any (a Map<K, V> with K bound to any): the keys
// compare by SameValueZero over the value they carry (NaN equals NaN, -0 equals 0, null and
// undefined stay distinct), and set, get, has, delete, size and forEach all answer as in Node.
function probe<K, V>(a: K, b: K, va: V, vb: V): string {
  const m: Map<K, V> = new Map();
  m.set(a, va);
  m.set(b, vb);
  m.set(a, vb);
  const got = m.get(a);
  return String(got) + "," + String(m.has(b)) + "," + String(m.delete(b)) + "," + String(m.has(b)) + "," + String(m.size);
}
console.log(probe<any, any>("a", 2, 1, "x"));
console.log(probe<any, any>(1.5, "1.5", true, 7));

function keysOf<K, V>(a: K, b: K, c: K, va: V): string {
  const m: Map<K, V> = new Map();
  m.set(a, va);
  m.set(b, va);
  m.set(c, va);
  let keys = "";
  m.forEach((_v, k) => {
    keys = keys + String(k) + ";";
  });
  return String(m.size) + " " + String(m.has(a)) + " " + String(m.has(b)) + " " + String(m.has(c)) + " " + keys;
}
console.log(keysOf<any, any>(NaN, NaN, 0, 1));
console.log(keysOf<any, any>(-0, 0, null, 2));
console.log(keysOf<any, any>(undefined, null, "x", 3));
