// Cached accessors installed by a helper over a literal name list, mysql2's column_definition
// shape: the helper writes a prototype datum under a template key and defines an accessor by
// the bare name; the getter reads and writes its per-instance cache under the same template keys.
// The instance carries literal start/length fields. Reads are cached (the second read returns the
// stored value), `in` and hasOwnProperty on the cache key flip after the first read.
class Col {
  constructor(buf, n) {
    this._buf = buf;
    this._aStart = 0;
    this._aLength = n;
    this._bStart = n;
    this._bLength = buf.length - n;
  }
}
const addCached = function (name) {
  const cacheKey = `_${name}Value`;
  const startKey = `_${name}Start`;
  const lengthKey = `_${name}Length`;
  Col.prototype[cacheKey] = undefined;
  Object.defineProperty(Col.prototype, name, {
    get: function () {
      const cached = this[cacheKey];
      if (cached !== undefined) {
        return cached;
      }
      const start = this[startKey];
      const end = start + this[lengthKey];
      const val = String(this._buf.slice(start, end)).toUpperCase();
      this[cacheKey] = val;
      return val;
    },
  });
};
addCached('a');
addCached('b');

const c = new Col('hello world', 5);
console.log('before', '_aValue' in c, c.hasOwnProperty('_aValue'), c._aValue);
console.log('first', c.a, c.b);
console.log('second', c.a, c.b);
console.log('after', '_aValue' in c, c.hasOwnProperty('_aValue'), c.hasOwnProperty('_bValue'));
const d = new Col('abcdef', 2);
console.log('other', d.b, d.a, c.hasOwnProperty('_bValue'));
