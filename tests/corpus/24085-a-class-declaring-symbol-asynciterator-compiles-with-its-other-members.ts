// A class that DECLARES [Symbol.asyncIterator] (the protocol hook a driver's cursor carries) compiles, and its other members work. The
// hook itself is declared only: reaching it through the symbol stays refused (for await over such a class is not lowered).
class Feed {
  private n: number;
  closed = false;
  constructor(n: number) { this.n = n; }
  [Symbol.asyncIterator](): AsyncIterator<number> {
    let i = 0;
    const n = this.n;
    return { next: async () => (i < n ? { value: i++, done: false } : { value: undefined, done: true }) };
  }
  size(): number { return this.n; }
  close(): void { this.closed = true; }
}
const f = new Feed(3);
console.log(f.size(), f.closed);
f.close();
console.log(f.closed, f instanceof Feed);
