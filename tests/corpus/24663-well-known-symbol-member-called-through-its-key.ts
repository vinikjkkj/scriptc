/// <reference lib="esnext.disposable" />
// A class member declared under a well-known symbol (`[Symbol.dispose]()`, `async *[Symbol.asyncIterator]()`) and
// reached through its key: the explicit `x[Symbol.dispose]()` call runs the member with the receiver as `this`, and the
// async iterator drives a `for await`.
class Resource {
  released = 0;
  [Symbol.dispose](): void {
    this.released += 1;
  }
}
class Feed {
  async *[Symbol.asyncIterator](): AsyncGenerator<number> {
    yield 1;
    yield 2;
  }
}
const a = new Resource();
const b = new Resource();
a[Symbol.dispose]();
a[Symbol.dispose]();
b[Symbol.dispose]();
console.log(a.released, b.released);
(async () => {
  const seen: number[] = [];
  for await (const x of new Feed()) seen.push(x);
  console.log(seen.join(","));
})();
