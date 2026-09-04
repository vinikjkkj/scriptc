// A registry-symbol-keyed class member DECLARES a slot but dispatches to
// nothing: `x[S]` element access keeps the symbol fence, exactly as
// `[Symbol.dispose]` does. The class below compiles; the READ is what
// fails, and that is the contract.
const KEY = Symbol.for('@@diag.key');

class Holder {
  get [KEY](): number {
    return 1;
  }
  [Symbol.for('@@diag.call')](): number {
    return 2;
  }
  plain(): number {
    return 3;
  }
}

const h = new Holder();
console.log(h.plain());
console.log(h[KEY]);
