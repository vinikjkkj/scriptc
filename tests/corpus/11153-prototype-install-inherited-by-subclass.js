// A class derived from the wrapper inherits the installed forwarders: a call and a typeof on the
// subclass instance reach the base method through this.connection, and the subclass's own
// methods sit beside them.
class Base {
  constructor(id) { this.id = id; }
  query(sql, n) { return 'query:' + sql + ':' + n + '#' + this.id; }
  format(s) { return 'fmt[' + s + ']'; }
}
class Wrap {
  constructor(conn) { this.connection = conn; }
}
class Leaf extends Wrap {
  constructor(conn) { super(conn); this.tag = 'L'; }
  tagged() { return 'leaf:' + this.tag; }
}
(function (names) {
  for (let i = 0; names && i < names.length; i++) {
    const func = names[i];
    if (typeof Base.prototype[func] === 'function' && Wrap.prototype[func] === undefined) {
      Wrap.prototype[func] = (function factory(funcName) {
        return function () { return Base.prototype[funcName].apply(this.connection, arguments); };
      })(func);
    }
  }
})(['query', 'format']);
const a = new Wrap(new Base(1));
const b = new Leaf(new Base(2));
console.log(a.query('x', 2), '|', a.format('y'));
console.log(b.query('z', 5), '|', b.format('w'), '|', typeof b.query, 'format' in b, b.tagged());
