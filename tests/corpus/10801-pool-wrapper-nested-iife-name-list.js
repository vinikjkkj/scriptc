// Pool-shaped wrapper builder: the name list reaches the IIFE through a second IIFE, the wrapper
// forwards its own arguments to the base prototype's method, and the list holds names no class
// answers (numeric text, the empty string) next to two real members of a two-level hierarchy.
class BasePool {
  constructor(tag) { this.tag = tag; this.hits = 0; }
  get size() { return 2; }
  escape(s) { this.hits++; return 'esc(' + s + ')'; }
  escapeId(s) { return 'id(' + s + ')' + this.tag; }
  format(sql, v) { return sql + '<' + v + '>' + this.tag; }
}
class ClusterPool extends BasePool {
  constructor(tag) { super(tag); }
  format(sql) { return 'cluster:' + sql; }
}
class PromisePool {
  constructor(pool) { this.pool = pool; }
}
const wrappers = new Map();
((names) => {
  (function install(list) {
    for (let i = 0; list && i < list.length; i++) {
      const func = list[i];
      if (typeof BasePool.prototype[func] === 'function') {
        wrappers.set(func, (function factory(funcName) {
          return function () {
            return BasePool.prototype[funcName].apply(this.pool, arguments);
          };
        })(func));
      }
    }
  })(names);
})(['escape', '0', '', 'escapeId', 'format']);
const pp = new PromisePool(new ClusterPool('T'));
console.log(wrappers.size, [...wrappers.keys()].join(','));
console.log(wrappers.get('escape').call(pp, 'a b'));
console.log(wrappers.get('escapeId').call(pp, 'col'));
console.log(wrappers.get('format').call(pp, 'SELECT', 9));
console.log(pp.pool.hits, new ClusterPool('U').format('x'));
