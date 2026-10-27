// A class whose instance cache fields come from a literal-named helper (mysql2's column_definition
// shape). Their own-key insertion order is not tracked, so every enumeration of an instance refuses
// at compile time with a named diagnostic instead of answering in declaration order.
class Col {
  constructor(buf) {
    this._buf = buf;
  }
}
const addCached = function (name) {
  const cacheKey = `_${name}Value`;
  Col.prototype[cacheKey] = undefined;
  Object.defineProperty(Col.prototype, name, {
    get: function () {
      const cached = this[cacheKey];
      if (cached !== undefined) {
        return cached;
      }
      const val = String(this._buf).toUpperCase();
      this[cacheKey] = val;
      return val;
    },
  });
};
addCached('a');
const c = new Col('xy');
console.log(c.a);
console.log(Object.keys(c));
console.log(Object.values(c));
console.log(Object.entries(c));
console.log(JSON.stringify(c));
for (const k in c) console.log(k);
console.log(c);
const s = { ...c };
const t = Object.assign({}, c);
console.log(s, t);
