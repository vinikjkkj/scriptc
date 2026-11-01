// A subclass that forwards its options and reads its own member too.
class F extends Error {
  constructor(message: string, options: { cause?: unknown; tag: string }) {
    super(message, options);
    this.name = 'F' + options.tag;
  }
}
const withCause = { tag: 'T', cause: 'str' };
const f1 = new F('g', withCause);
console.log(f1.name, f1.message, String((f1 as Error & { cause?: unknown }).cause));
const noCause = { tag: 'U' };
const f2 = new F('h', noCause);
console.log(f2.name, f2.message, String((f2 as Error & { cause?: unknown }).cause));
