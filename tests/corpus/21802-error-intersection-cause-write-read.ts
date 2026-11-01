// cause: written through the intersection, read back through the intersection and through the Error view.
function wrap(msg: string, inner: Error): Error & { cause?: unknown } {
  const e: Error & { cause?: unknown } = new Error(msg);
  e.cause = inner;
  return e;
}
const w = wrap('outer', new Error('inner'));
console.log(w.message, (w.cause as Error).message);
const base: Error = w;
console.log(base.message, (base as Error & { cause?: unknown }).cause === w.cause);
const plain = new Error('p') as Error & { cause?: unknown };
console.log(plain.cause === undefined, plain.name);
