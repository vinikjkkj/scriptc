// The forwarder passes exactly the arguments it receives: a missing argument stays missing for the
// base method (undefined), an explicit undefined is forwarded as undefined, and the base method
// returns through the wrapper.
class Base {
  constructor(id) { this.id = id; }
  query(a, b, c) { return 'x:' + a + ',' + b + ',' + c + '#' + this.id; }
  close(n) { return 'closed:' + n + '#' + this.id; }
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
})(['query', 'close']);
const w = new Wrap(new Base(9));
console.log(w.query());
console.log(w.query('a'));
console.log(w.query('a', undefined, 3));
console.log(w.close(), w.close(1));
