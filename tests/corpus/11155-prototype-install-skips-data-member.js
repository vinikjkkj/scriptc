// A base member that is a data field (an instance field, so absent from the base prototype) is
// skipped by the install guard; the function-valued name beside it is installed.
class Base {
  size = 2;
  constructor(id) { this.id = id; }
  query(sql) { return 'q:' + sql; }
}
class Wrap { constructor(c) { this.connection = c; } }
(function (names) {
  for (let i = 0; names && i < names.length; i++) {
    const func = names[i];
    if (typeof Base.prototype[func] === 'function' && Wrap.prototype[func] === undefined) {
      Wrap.prototype[func] = (function factory(funcName) {
        return function () { return Base.prototype[funcName].apply(this.connection, arguments); };
      })(func);
    }
  }
})(['size', 'query']);
const w = new Wrap(new Base(4));
console.log(typeof w.query, 'size' in w, w.query('A'));
