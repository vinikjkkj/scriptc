// Object.assign(error, { cause }) as a statement: the ioredis shape.
function reason(cause: unknown): Error {
  const newReason = new Error(String(cause));
  Object.assign(newReason, { cause });
  return newReason;
}
const r = reason(new Error('root'));
console.log(r.message);
console.log((r as Error & { cause?: unknown }).cause === undefined);
const r2 = reason('text');
console.log(r2.message);
