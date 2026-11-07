/// <reference lib="esnext.disposable" />
// The well-known symbols read as VALUES: one identity per name on every read, typeof "symbol", Node's descriptions and
// String() spellings, never in the Symbol.for registry, and the `(Symbol.dispose as any) ?? Symbol("dispose")` const a
// library uses to key a member (mongodb's kDispose).
const a = Symbol.dispose;
const b = Symbol.asyncDispose;
console.log(typeof a, typeof b, a === Symbol.dispose, b === Symbol.asyncDispose, a !== b);
console.log(String(a), a.description, String(b), b.description, Symbol.keyFor(a), Symbol.keyFor(b));
const names = [Symbol.iterator, Symbol.asyncIterator, Symbol.hasInstance, Symbol.toPrimitive, Symbol.toStringTag, Symbol.species];
console.log(names.map((s) => s.description).join(","), names.map((s) => typeof s).join(","));
console.log(Symbol.iterator === Symbol.iterator, (Symbol.iterator as symbol) === Symbol.asyncIterator, Symbol.for("Symbol.iterator") === Symbol.iterator);

const kDispose: unique symbol = (Symbol.dispose as any) ?? Symbol("dispose");
console.log((kDispose as symbol) === Symbol.dispose, typeof kDispose, String(kDispose));

interface Releasable {
  [kDispose](): void;
}
let disposed = 0;
function listen(on: boolean): Releasable | undefined {
  return on ? { [kDispose]: () => { disposed += 1; } } : undefined;
}
const live = listen(true);
live?.[kDispose]();
listen(false)?.[kDispose]();
console.log(disposed);
