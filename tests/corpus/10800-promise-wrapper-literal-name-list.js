// Promise-wrapper builder in mysql2's shape over a three-level class hierarchy: a literal list of
// method names walked by an IIFE; each name is read off a base prototype with a computed key,
// wrapped by a factory IIFE, and invoked on a receiver. A getter sits in the chain (not listed),
// a middle class overrides one name, and a listed name is absent from the whole chain.
class Base {
  constructor(id) { this.id = id; }
  get state() { return 'state:' + this.id; }
  close() { return 'close#' + this.id; }
  query(sql, n) { return 'query:' + sql + ':' + n + '#' + this.id; }
  format(s) { return 'fmt[' + s + ']'; }
}
class Middle extends Base {
  constructor(id) { super(id); }
  query(sql) { return 'middle:' + sql + '#' + this.id; }
  ping() { return 'ping#' + this.id; }
}
class Leaf extends Middle {
  constructor(id) { super(id); this.extra = id * 2; }
  close() { return 'leaf-close#' + this.extra; }
}
class PromiseWrapper {
  constructor(conn) { this.connection = conn; }
}
const wrapped = new Map();
(function build(names) {
  for (let i = 0; names && i < names.length; i++) {
    const func = names[i];
    if (typeof Base.prototype[func] === 'function' && wrapped.get(func) === undefined) {
      wrapped.set(func, (function factory(funcName) {
        return function () {
          return Base.prototype[funcName].apply(this.connection, arguments);
        };
      })(func));
    }
  }
})(['close', 'query', 'format', 'absent', 'ping', 'close']);
const pw = new PromiseWrapper(new Leaf(7));
const seen = [];
for (const name of ['close', 'query', 'format', 'absent', 'ping', 'state']) {
  const w = wrapped.get(name);
  seen.push(name + ':' + typeof w);
  if (w !== undefined) console.log(name, w.call(pw, 'SQL', 3));
  else console.log(name, 'not wrapped');
}
console.log(seen.join(' '), wrapped.size);
console.log('leaf close', new Leaf(2).close(), 'base close', Base.prototype.close.call(new Leaf(2)));
