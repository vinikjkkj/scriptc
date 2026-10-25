// mysql2's promise facade in its own shape: a literal name list walked by an IIFE; each name that a
// base prototype answers as a function, and that the wrapper class does not already define, is
// installed on the wrapper prototype as a forwarder (factory IIFE, receiver this.connection). A name
// the wrapper defines is skipped, a name the base lacks is skipped, a getter-free base member is called.
class BaseConnection {
  constructor(id) { this.id = id; }
  close() { return 'close#' + this.id; }
  query(sql, n) { return 'query:' + sql + ':' + n + '#' + this.id; }
  format(s) { return 'fmt[' + s + ']'; }
  pause() { return 'paused#' + this.id; }
}
class PromiseConnection {
  constructor(conn) { this.connection = conn; }
  close() { return 'own-close'; }
}
(function (functionsToWrap) {
  for (let i = 0; functionsToWrap && i < functionsToWrap.length; i++) {
    const func = functionsToWrap[i];
    if (typeof BaseConnection.prototype[func] === 'function' && PromiseConnection.prototype[func] === undefined) {
      PromiseConnection.prototype[func] = (function factory(funcName) {
        return function () {
          return BaseConnection.prototype[funcName].apply(this.connection, arguments);
        };
      })(func);
    }
  }
})(['close', 'query', 'format', 'absent', 'pause']);
const pc = new PromiseConnection(new BaseConnection(7));
console.log(typeof pc.query, typeof pc.format, typeof pc.pause, typeof pc.close);
console.log('query' in pc, 'format' in pc, 'absent' in pc, 'close' in pc);
console.log(pc.query('SQL', 3), '|', pc.format('x'), '|', pc.pause(), '|', pc.close());
