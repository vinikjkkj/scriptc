// mysql2 shape: a facade installs a variadic forwarder on the wrapper; a subclass overrides it with a fixed arity.
class BaseConnection {
  constructor(id) { this.id = id; }
  destroy() { return 'base-destroy#' + this.id; }
  query(sql, n) { return 'query:' + sql + ':' + n + '#' + this.id; }
}
class PromiseConnection {
  constructor(conn) { this.connection = conn; }
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
})(['destroy', 'query']);
class PoolConnection extends PromiseConnection {
  destroy() { return 'pool-destroy:' + this.connection.id; }
}
const p = new PoolConnection(new BaseConnection(7));
console.log(p.destroy(), p.query('q', 2));
const q = new PromiseConnection(new BaseConnection(8));
console.log(q.destroy(1, 2), q.query('z', 3));
const back = p;
const r = back.destroy(9, 9);
console.log(r === undefined ? 'u' : r);
