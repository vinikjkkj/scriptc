// A name list that repeats names: each name installs once (the second visit sees the first install
// and is skipped), a name the wrapper defines itself is never replaced, and a name the base lacks
// stays absent on the instance.
class Base {
  constructor(id) { this.id = id; }
  close() { return 'close#' + this.id; }
  query(sql, n) { return 'query:' + sql + ':' + n + '#' + this.id; }
  format(s) { return 'fmt[' + s + ']'; }
}
class Wrap {
  constructor(conn) { this.connection = conn; }
  ping() { return 'ping:' + this.connection.id; }
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
})(['query', 'format', 'query', 'ping', 'close', 'format', 'nope']);
const w = new Wrap(new Base(3));
console.log(typeof w.query, typeof w.format, typeof w.ping, typeof w.close, 'close' in w, 'nope' in w);
console.log(w.query('A', 1), '|', w.format('B'), '|', w.ping(), '|', w.close());
