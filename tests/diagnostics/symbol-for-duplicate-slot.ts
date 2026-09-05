// Two consts, ONE registry symbol. tsc types them as distinct unique
// symbols and late-binds two members; Symbol.for hands both the one
// runtime symbol, so JS keeps only the last definition. One slot is the
// right model, but a class declaring the pair has no single honest answer
// here — so it is refused rather than silently resolved to one of them.
const A = Symbol.for('@@diag.dup');
const B = Symbol.for('@@diag.dup');

class Holder {
  get [A](): number {
    return 1;
  }
  get [B](): number {
    return 2;
  }
  plain(): number {
    return 3;
  }
}

const h = new Holder();
console.log(h.plain());
