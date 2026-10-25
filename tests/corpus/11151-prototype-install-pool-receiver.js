// The pool shape: the name list reaches the install loop through a nested IIFE and an arrow, the
// forwarders receive their receiver from a different field (this.pool), and a name the base lacks
// is skipped. The base's getter stays off the list: a getter's value on a prototype is not decided.
class BasePool {
  constructor(tag) { this.tag = tag; this.hits = 0; }
  get size() { return 2; }
  escape(s) { this.hits++; return 'esc(' + s + ')'; }
  escapeId(s) { return 'id(' + s + ')' + this.tag; }
  format(sql, v) { return sql + '<' + v + '>' + this.tag; }
}
class PromisePool {
  constructor(pool) { this.pool = pool; }
}
((names) => {
  (function install(list) {
    for (let i = 0; list && i < list.length; i++) {
      const func = list[i];
      if (typeof BasePool.prototype[func] === 'function' && PromisePool.prototype[func] === undefined) {
        PromisePool.prototype[func] = (function factory(funcName) {
          return function () {
            return BasePool.prototype[funcName].apply(this.pool, arguments);
          };
        })(func);
      }
    }
  })(names);
})(['escape', 'escapeId', 'format', 'missing']);
const pp = new PromisePool(new BasePool('T'));
console.log(typeof pp.escape, typeof pp.escapeId, typeof pp.format, 'size' in pp, 'missing' in pp);
console.log(pp.escape('a b'));
console.log(pp.escapeId('col'));
console.log(pp.format('SELECT', 9));
console.log(pp.pool.hits);
